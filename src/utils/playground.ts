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

// Start WordPress Playground in an iframe
export const initializePlayground = async (
  iframe: HTMLIFrameElement,
  siteId: string,
  onReady?: () => void
): Promise<any> => {
  try {
    console.log(`Initializing WordPress Playground for site: ${siteId}`);
    
    const client = await startPlaygroundWeb({
      iframe,
      remoteUrl: `https://playground.wordpress.net/remote.html`,
      blueprint: PLAYGROUND_CONFIG.blueprint
    });

    console.log('WordPress Playground initialized successfully');
    
    if (onReady) {
      onReady();
    }

    return client;
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
    const sitesDir = await opfsRoot.getDirectoryHandle('wp-studio/sites', { create: true });
    const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: true });

    // Export the WordPress filesystem from Playground
    const zipFile = await client.exportWPContent();
    
    // Store the zip file in OPFS
    const fileHandle = await siteDir.getFileHandle('wordpress.zip', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(zipFile);
    await writable.close();

    console.log(`Successfully synced memfs to OPFS for site: ${siteId}`);
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
    const sitesDir = await opfsRoot.getDirectoryHandle('wp-studio/sites', { create: false });
    const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: false });

    // Load the zip file from OPFS
    const fileHandle = await siteDir.getFileHandle('wordpress.zip');
    const file = await fileHandle.getFile();
    const zipData = await file.arrayBuffer();

    // Import the WordPress filesystem into Playground
    await client.importWPContent(new Uint8Array(zipData));

    console.log(`Successfully synced OPFS to memfs for site: ${siteId}`);
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