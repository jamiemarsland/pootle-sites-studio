import { supabase } from '@/integrations/supabase/client';
import { Site } from '@/types/site';
import { getSiteOPFSDirectory } from './storage';

// Upload site files to cloud storage
export const uploadSiteToCloud = async (siteId: string, userId: string): Promise<void> => {
  try {
    console.log(`[CloudSync] Uploading site ${siteId} to cloud...`);
    
    // Get OPFS directory for the site
    const siteDir = await getSiteOPFSDirectory(siteId);
    
    // Export database and files from OPFS
    const files: { name: string; data: Uint8Array }[] = [];
    
    for await (const [name, handle] of (siteDir as any).entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        files.push({ name, data: new Uint8Array(arrayBuffer) });
      }
    }

    // Upload each file to Supabase Storage
    for (const file of files) {
      const path = `${userId}/${siteId}/${file.name}`;
      const { error } = await supabase.storage
        .from('wordpress-sites')
        .upload(path, file.data, { 
          upsert: true,
          contentType: 'application/octet-stream'
        });

      if (error) {
        console.error(`[CloudSync] Failed to upload ${file.name}:`, error);
        throw error;
      }
    }

    console.log(`[CloudSync] Successfully uploaded ${files.length} files`);
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

    // List all files for this site in cloud storage
    const { data: files, error: listError } = await supabase.storage
      .from('wordpress-sites')
      .list(`${userId}/${siteId}`);

    if (listError) throw listError;
    if (!files || files.length === 0) {
      console.log('[CloudSync] No files found in cloud storage');
      return;
    }

    // Download each file
    for (const file of files) {
      const path = `${userId}/${siteId}/${file.name}`;
      const { data, error } = await supabase.storage
        .from('wordpress-sites')
        .download(path);

      if (error) {
        console.error(`[CloudSync] Failed to download ${file.name}:`, error);
        continue;
      }

      // Write to OPFS
      const fileHandle = await siteDir.getFileHandle(file.name, { create: true });
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
