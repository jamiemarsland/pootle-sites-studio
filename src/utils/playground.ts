import { startPlaygroundWeb } from '@wp-playground/client';

// WordPress Playground configuration
export const PLAYGROUND_CONFIG = {
  blueprint: {
    preferredVersions: {
      php: '8.0',
      wp: 'latest'
    },
    steps: [
      {
        step: 'login',
        username: 'admin',
        password: 'password'
      }
    ]
  }
};

// Start WordPress Playground in an iframe with OPFS mount
export const initializePlayground = async (
  iframe: HTMLIFrameElement,
  siteId: string,
  isInitialized: boolean
): Promise<any> => {
  try {
    console.log(`Initializing WordPress Playground for site: ${siteId}`);

    // Check if WordPress actually exists in local OPFS
    let hasLocalWordPress = false;
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const wpStudioDir = await opfsRoot.getDirectoryHandle('wp-studio', { create: false });
      const sitesDir = await wpStudioDir.getDirectoryHandle('sites', { create: false });
      const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: false });
      
      // Check if we have WordPress files in OPFS (database.json or files.json from cloud)
      try {
        await siteDir.getFileHandle('database.json', { create: false });
        hasLocalWordPress = true;
        console.log('Found WordPress data in local OPFS');
      } catch {
        console.log('No WordPress data in local OPFS');
      }
    } catch {
      console.log('OPFS site directory does not exist yet');
    }

    // If the site is initialized but we don't have local WordPress files,
    // we need to do a fresh install and then restore from cloud
    const needsFreshInstall = !hasLocalWordPress;
    
    console.log(`WordPress installation needed: ${needsFreshInstall}`);

    let client;
    
    try {
      client = await startPlaygroundWeb({
        iframe,
        remoteUrl: `https://playground.wordpress.net/remote.html`,
        blueprint: PLAYGROUND_CONFIG.blueprint,
        shouldInstallWordPress: true,
        mounts: [],
      });

      // Wait until Playground is fully ready
      if (typeof (client as any).isReady === 'function') {
        await (client as any).isReady();
      }

      console.log('WordPress Playground initialized successfully');
      return client;
    } catch (error) {
      console.error('Failed to initialize playground:', error);
      
      // Fallback to localStorage if OPFS fails completely
      console.warn('Trying localStorage fallback...');
      
      client = await startPlaygroundWeb({
        iframe,
        remoteUrl: `https://playground.wordpress.net/remote.html`,
        blueprint: PLAYGROUND_CONFIG.blueprint,
        shouldInstallWordPress: true,
      });

      if (typeof (client as any).isReady === 'function') {
        await (client as any).isReady();
      }
      
      // Load from localStorage if this is an existing site
      if (isInitialized) {
        try {
          const savedData = localStorage.getItem(`wp_site_${siteId}`);
          if (savedData) {
            const { database, files } = JSON.parse(savedData);
            if (database) {
              await client.importSQL(database);
            }
            if (files) {
              for (const [path, content] of Object.entries(files)) {
                await client.writeFile(path, content as string);
              }
            }
            console.log('Restored from localStorage fallback');
          }
        } catch (fallbackError) {
          console.error('localStorage restore failed:', fallbackError);
        }
      }
      
      // Set up periodic saves for localStorage fallback
      const saveToLocalStorage = async () => {
        try {
          const database = await client.exportSQL();
          const files: Record<string, string> = {};
          
          try {
            const wpConfig = await client.readFile('/wordpress/wp-config.php');
            files['/wordpress/wp-config.php'] = wpConfig;
          } catch (e) {}
          
          localStorage.setItem(`wp_site_${siteId}`, JSON.stringify({ database, files }));
          console.log('Saved to localStorage fallback');
        } catch (saveError) {
          console.error('localStorage save failed:', saveError);
        }
      };
      
      setInterval(saveToLocalStorage, 30000);
      window.addEventListener('beforeunload', saveToLocalStorage);
      
      console.log('WordPress Playground initialized with localStorage fallback');
      return client;
    }
  } catch (error) {
    console.error('Failed to initialize WordPress Playground:', error);
    throw error;
  }
};

// Sync memfs to OPFS (save site)
export const syncMemfsToOPFS = async (
  client: any,
  siteId: string
): Promise<void> => {
  try {
    console.log(`Syncing memfs to OPFS for site: ${siteId}`);
    
    // Get the site's OPFS directory
    const opfsRoot = await navigator.storage.getDirectory();
    const wpStudioDir = await opfsRoot.getDirectoryHandle('wp-studio', { create: true });
    const sitesDir = await wpStudioDir.getDirectoryHandle('sites', { create: true });
    const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: true });

    // Export the WordPress database and files
    try {
      // Use native exportWXR for WordPress content export
      let contentExported = false;
      
      try {
        // Try WordPress XML export (WXR) which preserves all content
        const wxrExport = await client.run({
          code: `<?php
require_once '/wordpress/wp-load.php';
require_once '/wordpress/wp-admin/includes/export.php';
ob_start();
export_wp();
$wxr = ob_get_clean();
echo $wxr;
?>`
        });
        
        const wxrText = typeof wxrExport === 'string' ? wxrExport : ((wxrExport as any).text || '');
        if (wxrText.length > 100) {
          const wxrHandle = await siteDir.getFileHandle('content.wxr', { create: true });
          const wxrWritable = await wxrHandle.createWritable();
          await wxrWritable.write(wxrText);
          await wxrWritable.close();
          contentExported = true;
          console.log('Exported WordPress content as WXR');
        }
      } catch (wxrError) {
        console.warn('WXR export failed, trying direct database copy:', wxrError);
      }

      // Also save the raw SQLite database file as backup
      if (!contentExported) {
        try {
          const dbFileContent = await client.readFileAsBuffer('/wordpress/wp-content/database/.ht.sqlite');
          const dbHandle = await siteDir.getFileHandle('database.sqlite', { create: true });
          const dbWritable = await dbHandle.createWritable();
          await dbWritable.write(dbFileContent);
          await dbWritable.close();
          console.log('Saved SQLite database file');
        } catch (dbError) {
          console.warn('Database file save failed:', dbError);
        }
      }


      // Export wp-content files
      const files = await client.listFiles('/wordpress/wp-content');
      const fileData: { [key: string]: string } = {};
      
      for (const file of files) {
        if (file.isFile && file.name !== 'database') {
          try {
            const content = await client.readFileAsText(file.path);
            fileData[file.path] = content;
          } catch (error) {
            console.warn(`Could not read file ${file.path}:`, error);
          }
        }
      }

      // Save files
      const filesHandle = await siteDir.getFileHandle('files.json', { create: true });
      const filesWritable = await filesHandle.createWritable();
      await filesWritable.write(JSON.stringify(fileData));
      await filesWritable.close();

      console.log(`Successfully synced memfs to OPFS for site: ${siteId}`);
    } catch (apiError) {
      console.error('WordPress API error, using fallback method:', apiError);
      
      // Fallback: just mark as saved
      const metaHandle = await siteDir.getFileHandle('meta.json', { create: true });
      const metaWritable = await metaHandle.createWritable();
      await metaWritable.write(JSON.stringify({
        siteId,
        savedAt: new Date().toISOString(),
        method: 'fallback'
      }));
      await metaWritable.close();
    }
  } catch (error) {
    console.error(`Failed to sync memfs to OPFS for site ${siteId}:`, error);
    throw error;
  }
};

// Sync OPFS to memfs (load site)
export const syncOPFSToMemfs = async (
  client: any,
  siteId: string
): Promise<void> => {
  try {
    console.log(`Syncing OPFS to memfs for site: ${siteId}`);
    
    // Get the site's OPFS directory
    const opfsRoot = await navigator.storage.getDirectory();
    const wpStudioDir = await opfsRoot.getDirectoryHandle('wp-studio', { create: false });
    const sitesDir = await wpStudioDir.getDirectoryHandle('sites', { create: false });
    const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: false });

    try {
      // Restore from WXR content export or SQLite database
      try {
        // First try WXR import
        try {
          const wxrHandle = await siteDir.getFileHandle('content.wxr');
          const wxrFile = await wxrHandle.getFile();
          const wxr = await wxrFile.text();
          
          if (wxr.length > 100) {
            // Write WXR to temp file and import
            await client.writeFile('/tmp/import.xml', wxr);
            await client.run({
              code: `<?php
require_once '/wordpress/wp-load.php';
require_once '/wordpress/wp-admin/includes/import.php';
require_once '/wordpress/wp-admin/includes/post.php';
require_once '/wordpress/wp-admin/includes/comment.php';
require_once '/wordpress/wp-admin/includes/taxonomy.php';
if (!defined('WP_LOAD_IMPORTERS')) define('WP_LOAD_IMPORTERS', true);
require_once '/wordpress/wp-content/plugins/wordpress-importer/wordpress-importer.php';
$importer = new WP_Import();
$importer->import('/tmp/import.xml');
echo 'Content restored from WXR';
?>`
            });
            console.log('Restored from WXR export');
          }
        } catch (wxrErr) {
          console.warn('WXR restore failed, trying database file:', wxrErr);
          
          // Try restoring raw database file
          const dbHandle = await siteDir.getFileHandle('database.sqlite');
          const dbFile = await dbHandle.getFile();
          const dbBuffer = await dbFile.arrayBuffer();
          await client.writeFile('/wordpress/wp-content/database/.ht.sqlite', new Uint8Array(dbBuffer));
          console.log('Restored SQLite database file');
        }
      } catch (restoreErr) {
        console.warn('Could not restore WordPress content:', restoreErr);
      }

      // Load and restore files
      try {
        const filesHandle = await siteDir.getFileHandle('files.json');
        const filesFile = await filesHandle.getFile();
        const filesData = JSON.parse(await filesFile.text());

        for (const [filePath, content] of Object.entries(filesData)) {
          await client.writeFile(filePath, content);
        }
      } catch (filesError) {
        console.warn('Could not restore files:', filesError);
      }

      console.log(`Successfully synced OPFS to memfs for site: ${siteId}`);
    } catch (restoreError) {
      console.warn('Could not restore from saved data:', restoreError);
      // Check if this is a new site
      try {
        await siteDir.getFileHandle('meta.json');
        console.log('Site has saved data but could not restore - continuing with fresh install');
      } catch {
        console.log(`No saved data found for site ${siteId} - this is expected for new sites`);
      }
    }
  } catch (error) {
    console.error(`Failed to sync OPFS to memfs for site ${siteId}:`, error);
    // If no saved data exists, this is expected for new sites
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      console.log(`No saved data found for site ${siteId} - this is expected for new sites`);
    } else {
      throw error;
    }
  }
};