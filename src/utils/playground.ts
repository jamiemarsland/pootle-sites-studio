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
      
      // Check for a durable marker indicating WordPress core is present in OPFS
      try {
        await siteDir.getFileHandle('core.marker', { create: false });
        hasLocalWordPress = true;
        console.log('Found WordPress core marker in OPFS');
      } catch {
        console.log('No WordPress core marker in OPFS');
      }
    } catch {
      console.log('OPFS site directory does not exist yet');
    }

    // If the site is initialized but we don't have local WordPress files,
    // we need to do a fresh install and then restore from cloud
    const needsFreshInstall = !hasLocalWordPress;
    
    console.log(`WordPress installation needed: ${needsFreshInstall}`);

    let client;
    
    // Configure OPFS mount so Playground persists directly to OPFS
    const mountDescriptor = {
      device: {
        type: 'opfs',
        path: `wp-studio/sites/${siteId}`,
      },
      mountpoint: '/wordpress',
      initialSyncDirection: hasLocalWordPress ? 'opfs-to-memfs' : 'memfs-to-opfs',
    } as any;

    client = await startPlaygroundWeb({
      iframe,
      remoteUrl: `https://playground.wordpress.net/remote.html`,
      blueprint: PLAYGROUND_CONFIG.blueprint,
      shouldInstallWordPress: !hasLocalWordPress,
      mounts: hasLocalWordPress ? [mountDescriptor] : [],
    });

    if (!hasLocalWordPress && typeof (client as any).mountOpfs === 'function') {
      await (client as any).mountOpfs(mountDescriptor);
    }

    if (typeof (client as any).isReady === 'function') {
      await (client as any).isReady();
    }

    // After initial install + mount, create a durable core marker in OPFS for future boots
    if (!hasLocalWordPress) {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const wpStudioDir = await opfsRoot.getDirectoryHandle('wp-studio', { create: true });
        const sitesDir = await wpStudioDir.getDirectoryHandle('sites', { create: true });
        const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: true });
        const markerHandle = await siteDir.getFileHandle('core.marker', { create: true });
        const markerWritable = await markerHandle.createWritable();
        await markerWritable.write(JSON.stringify({ createdAt: new Date().toISOString() }));
        await markerWritable.close();
        console.log('Created OPFS WordPress core marker');
      } catch (e) {
        console.warn('Failed to write core marker:', e);
      }
    }

    console.log('WordPress Playground initialized with OPFS mount');
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
    if (client && typeof client.flushOpfs === 'function') {
      await client.flushOpfs();
      console.log('flushOpfs completed');
    }
    // Touch meta file in OPFS as a heartbeat
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const wpStudioDir = await opfsRoot.getDirectoryHandle('wp-studio', { create: true });
      const sitesDir = await wpStudioDir.getDirectoryHandle('sites', { create: true });
      const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: true });
      const metaHandle = await siteDir.getFileHandle('meta.json', { create: true });
      const metaWritable = await metaHandle.createWritable();
      await metaWritable.write(JSON.stringify({ siteId, savedAt: new Date().toISOString(), method: 'mount' }));
      await metaWritable.close();
    } catch (_) {}
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
    // With OPFS mount, initialSyncDirection handles this restore automatically.
    // Optionally force a navigation to refresh UI if needed
    try {
      if (client && typeof (client as any).goTo === 'function') {
        await (client as any).goTo('/?t=' + Date.now());
      }
    } catch (_) {}
    console.log(`OPFS->memfs sync handled by mount for site: ${siteId}`);
  } catch (error) {
    console.error(`Failed to sync OPFS to memfs for site ${siteId}:`, error);
  }
};