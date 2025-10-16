import { supabase } from '@/integrations/supabase/client';
import { Site } from '@/types/site';
import { getSiteOPFSDirectory } from './storage';

// Upload site files to cloud storage (recursive with manifest)
export const uploadSiteToCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    console.log(`[CloudSync] Uploading site ${siteId} to cloud...`);

    // Get OPFS directory for the site
    const siteDir = await getSiteOPFSDirectory(siteId);

    // Recursively collect files from OPFS
    const collectFiles = async (
      dir: FileSystemDirectoryHandle,
      basePath = ''
    ): Promise<{ path: string; data: Uint8Array }[]> => {
      const out: { path: string; data: Uint8Array }[] = [];
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          out.push({ path: `${basePath}${name}`, data: new Uint8Array(arrayBuffer) });
        } else if (handle.kind === 'directory') {
          const nested = await collectFiles(handle, `${basePath}${name}/`);
          out.push(...nested);
        }
      }
      return out;
    };

    const files = await collectFiles(siteDir);

    // Upload each file to Storage preserving folder structure
    let uploaded = 0;
    for (const file of files) {
      const path = `${userId}/${siteId}/${file.path}`;
      const { error } = await supabase.storage
        .from('wordpress-sites')
        .upload(path, file.data, {
          upsert: true,
          contentType: 'application/octet-stream',
        });
      if (error) {
        console.error(`[CloudSync] Failed to upload ${file.path}:`, error);
        throw error;
      }
      uploaded++;
    }

    // Write manifest for reliable restore on new devices
    const manifest = { files: files.map((f) => f.path), generatedAt: new Date().toISOString() };
    const manifestPath = `${userId}/${siteId}/manifest.json`;
    const { error: manifestError } = await supabase.storage
      .from('wordpress-sites')
      .upload(manifestPath, new Blob([JSON.stringify(manifest)], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (manifestError) {
      console.warn('[CloudSync] Failed to upload manifest.json (will still continue):', manifestError);
    }

    console.log(`[CloudSync] Successfully uploaded ${uploaded} files (+ manifest)`);
  } catch (error) {
    console.error('[CloudSync] Upload failed:', error);
    throw error;
  }
};

// Download site files from cloud storage (uses manifest when available)
export const downloadSiteFromCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    console.log(`[CloudSync] Downloading site ${siteId} from cloud...`);

    const siteDir = await getSiteOPFSDirectory(siteId);

    // Helper to create nested directories for a file path
    const ensureDirectoryForFile = async (
      root: FileSystemDirectoryHandle,
      relPath: string
    ): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> => {
      const parts = relPath.split('/');
      const fileName = parts.pop() as string;
      let current = root;
      for (const part of parts) {
        current = await current.getDirectoryHandle(part, { create: true });
      }
      return { dir: current, fileName };
    };

    // Try manifest-based restore first
    const manifestPath = `${userId}/${siteId}/manifest.json`;
    const { data: manifestBlob } = await supabase.storage
      .from('wordpress-sites')
      .download(manifestPath);

    if (manifestBlob) {
      const manifestText = await manifestBlob.text();
      const manifest = JSON.parse(manifestText) as { files: string[] };
      let downloaded = 0;
      for (const relPath of manifest.files) {
        const { data, error } = await supabase.storage
          .from('wordpress-sites')
          .download(`${userId}/${siteId}/${relPath}`);
        if (error || !data) {
          console.warn(`[CloudSync] Skip missing file from manifest: ${relPath}`);
          continue;
        }
        const { dir, fileName } = await ensureDirectoryForFile(siteDir, relPath);
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        downloaded++;
      }
      console.log(`[CloudSync] Manifest restore completed: ${downloaded} files`);
      return;
    }

    // Fallback: top-level listing (legacy)
    const { data: files, error: listError } = await supabase.storage
      .from('wordpress-sites')
      .list(`${userId}/${siteId}`);

    if (listError) throw listError;
    if (!files || files.length === 0) {
      console.log('[CloudSync] No files found in cloud storage');
      return;
    }

    for (const file of files) {
      const path = `${userId}/${siteId}/${file.name}`;
      const { data, error } = await supabase.storage
        .from('wordpress-sites')
        .download(path);
      if (error || !data) {
        console.error(`[CloudSync] Failed to download ${file.name}:`, error);
        continue;
      }
      const { dir, fileName } = await ensureDirectoryForFile(siteDir, file.name);
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    }

    console.log(`[CloudSync] Successfully downloaded ${files.length} files`);
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
