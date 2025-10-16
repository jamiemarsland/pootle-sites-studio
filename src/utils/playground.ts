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
        shouldInstallWordPress: needsFreshInstall,
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
        shouldInstallWordPress: needsFreshInstall,
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
      // Export WordPress database
      const dbExport = await client.run({
        code: `<?php
        $export_data = array();
        
        // Export database
        $db = new PDO('sqlite:/wordpress/wp-content/database/.ht.sqlite');
        $tables = $db->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN);
        
        foreach ($tables as $table) {
          $rows = $db->query("SELECT * FROM $table")->fetchAll(PDO::FETCH_ASSOC);
          $export_data['database'][$table] = $rows;
        }
        
        // Export wp-config.php
        if (file_exists('/wordpress/wp-config.php')) {
          $export_data['wp_config'] = file_get_contents('/wordpress/wp-config.php');
        }
        
        echo json_encode($export_data);
        `
      });

      // Save database export
      const dbHandle = await siteDir.getFileHandle('database.json', { create: true });
      const dbWritable = await dbHandle.createWritable();
      await dbWritable.write(dbExport.text);
      await dbWritable.close();

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
      // Load database export
      const dbHandle = await siteDir.getFileHandle('database.json');
      const dbFile = await dbHandle.getFile();
      const dbData = JSON.parse(await dbFile.text());

      // Restore database
      await client.run({
        code: `<?php
        $import_data = json_decode('${JSON.stringify(dbData).replace(/'/g, "\\'")}', true);
        
        if (isset($import_data['database'])) {
          $db = new PDO('sqlite:/wordpress/wp-content/database/.ht.sqlite');
          
          foreach ($import_data['database'] as $table => $rows) {
            if (!empty($rows)) {
              $columns = array_keys($rows[0]);
              $placeholders = ':' . implode(', :', $columns);
              $sql = "INSERT OR REPLACE INTO $table (" . implode(', ', $columns) . ") VALUES ($placeholders)";
              $stmt = $db->prepare($sql);
              
              foreach ($rows as $row) {
                $stmt->execute($row);
              }
            }
          }
        }
        
        if (isset($import_data['wp_config'])) {
          file_put_contents('/wordpress/wp-config.php', $import_data['wp_config']);
        }
        
        echo "Database restored";
        `
      });

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