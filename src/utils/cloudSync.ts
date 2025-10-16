import { supabase } from '@/integrations/supabase/client';
import { Site } from '@/types/site';
import { getSiteOPFSDirectory } from './storage';

// Upload site files to cloud storage
export const uploadSiteToCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    console.log(`[CloudSync] Uploading site ${siteId} to cloud...`);

    // Get OPFS directory for the site
    const siteDir = await getSiteOPFSDirectory(siteId);

    type CollectedFile = { path: string; data: Uint8Array };
    const files: CollectedFile[] = [];
    const dirs: string[] = [];

    // Recursively walk the site's OPFS directory and collect all files
    const walk = async (dirHandle: any, basePath = ''): Promise<void> => {
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          const relPath = basePath ? `${basePath}/${name}` : name;
          files.push({ path: relPath, data: new Uint8Array(arrayBuffer) });
        } else if (handle.kind === 'directory') {
          const dirPath = basePath ? `${basePath}/${name}` : name;
          dirs.push(dirPath);
          await walk(handle, dirPath);
        }
      }
    };

    await walk(siteDir as any);

    // Upload each file to Storage
    for (const file of files) {
      const storagePath = `${userId}/${siteId}/${file.path}`;
      const { error } = await supabase.storage
        .from('wordpress-sites')
        .upload(storagePath, file.data, {
          upsert: true,
          contentType: 'application/octet-stream',
        });

      if (error) {
        console.error(`[CloudSync] Failed to upload ${file.path}:`, error);
        throw error;
      }
    }

    // Upload a manifest to enable reliable cross-device restore
    const manifest = {
      version: 1,
      generated_at: new Date().toISOString(),
      files: files.map((f) => f.path),
      dirs,
    };

    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const { error: manifestError } = await supabase.storage
      .from('wordpress-sites')
      .upload(`${userId}/${siteId}/manifest.json`, manifestBytes, {
        upsert: true,
        contentType: 'application/json',
      });

    if (manifestError) {
      console.warn('[CloudSync] Manifest upload warning:', manifestError);
    }

    console.log(`[CloudSync] Successfully uploaded ${files.length} files (${dirs.length} folders)`);
  } catch (error) {
    console.error('[CloudSync] Upload failed:', error);
    throw error;
  }
};

// Download site files from cloud storage
export const downloadSiteFromCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    console.log(`[CloudSync] Downloading site ${siteId} from cloud...`);

    const siteDir = await getSiteOPFSDirectory(siteId);

    // Attempt to use manifest.json for full, recursive restore
    const manifestPath = `${userId}/${siteId}/manifest.json`;
    const { data: manifestData, error: manifestError } = await supabase.storage
      .from('wordpress-sites')
      .download(manifestPath);

    if (!manifestError && manifestData) {
      const manifestText = await manifestData.text();
      const manifest = JSON.parse(manifestText) as { files: string[]; dirs?: string[] };

      // Helper: ensure directory exists (supports nested paths)
      const ensureDir = async (root: any, dirPath: string): Promise<any> => {
        let current = root;
        if (!dirPath) return current;
        for (const segment of dirPath.split('/')) {
          if (!segment) continue;
          current = await current.getDirectoryHandle(segment, { create: true });
        }
        return current;
      };

      // Create directories first (if provided)
      if (Array.isArray(manifest.dirs)) {
        for (const d of manifest.dirs) {
          await ensureDir(siteDir, d);
        }
      }

      // Download and write each file
      for (const relPath of manifest.files) {
        const { data, error } = await supabase.storage
          .from('wordpress-sites')
          .download(`${userId}/${siteId}/${relPath}`);

        if (error || !data) {
          console.error(`[CloudSync] Failed to download ${relPath}:`, error);
          continue;
        }

        const parts = relPath.split('/');
        const fileName = parts.pop() as string;
        const dirPath = parts.join('/');
        const targetDir = await ensureDir(siteDir, dirPath);

        const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(await data.arrayBuffer());
        await writable.close();
      }

      console.log(`[CloudSync] Successfully downloaded ${manifest.files.length} files`);
      return;
    }

    // Fallback: No manifest found
    console.log('[CloudSync] No manifest found in cloud storage for this site');
  } catch (error) {
    console.error('[CloudSync] Download failed:', error);
    throw error;
  }
};

// Sync site metadata to database
export const syncSiteMetadata = async (site: Site, userId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('sites')
      .upsert({
        id: site.id,
        user_id: userId,
        title: site.title,
        is_initialized: site.isInitialized,
        created_at: site.createdAt,
        last_modified: site.lastModified,
        last_synced_at: new Date().toISOString(),
        cloud_storage_path: `${userId}/${site.id}`
      });

    if (error) throw error;
    console.log(`[CloudSync] Metadata synced for site ${site.id}`);
  } catch (error) {
    console.error('[CloudSync] Metadata sync failed:', error);
    throw error;
  }
};

// Load sites from cloud database
export const loadSitesFromCloud = async (userId: string): Promise<Site[]> => {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select('*')
      .eq('user_id', userId)
      .order('last_modified', { ascending: false });

    if (error) throw error;

    return (data || []).map(site => ({
      id: site.id,
      title: site.title,
      createdAt: site.created_at,
      lastModified: site.last_modified,
      isInitialized: site.is_initialized
    }));
  } catch (error) {
    console.error('[CloudSync] Failed to load sites from cloud:', error);
    return [];
  }
};

// Delete site from cloud
export const deleteSiteFromCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    // Delete from database
    const { error: dbError } = await supabase
      .from('sites')
      .delete()
      .eq('id', siteId)
      .eq('user_id', userId);

    if (dbError) throw dbError;

    // Delete from storage
    const { data: files } = await supabase.storage
      .from('wordpress-sites')
      .list(`${userId}/${siteId}`);

    if (files && files.length > 0) {
      const filePaths = files.map(f => `${userId}/${siteId}/${f.name}`);
      const { error: storageError } = await supabase.storage
        .from('wordpress-sites')
        .remove(filePaths);

      if (storageError) console.error('[CloudSync] Storage deletion warning:', storageError);
    }

    console.log(`[CloudSync] Deleted site ${siteId} from cloud`);
  } catch (error) {
    console.error('[CloudSync] Cloud deletion failed:', error);
    throw error;
  }
};

// Initial sync - download all cloud sites to local OPFS
export const initialCloudSync = async (userId: string): Promise<void> => {
  try {
    console.log('[CloudSync] Starting initial sync from cloud...');
    const sites = await loadSitesFromCloud(userId);

    for (const site of sites) {
      await downloadSiteFromCloud(site.id, userId);
    }

    console.log(`[CloudSync] Initial sync complete: ${sites.length} sites`);
  } catch (error) {
    console.error('[CloudSync] Initial sync failed:', error);
    throw error;
  }
};
