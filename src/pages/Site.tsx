import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, ExternalLink, Plus, ChevronDown, EyeOff, Eye } from 'lucide-react';
import { getSiteMetadata, updateSite, requestPersistentStorage } from '@/utils/storage';
import { initializePlayground } from '@/utils/playground';
import { Site as SiteType } from '@/types/site';
import { useToast } from '@/hooks/use-toast';

const Site = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [site, setSite] = useState<SiteType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playgroundClient, setPlaygroundClient] = useState<any>(null);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isBarHidden, setIsBarHidden] = useState(() => {
    return localStorage.getItem('pootle-bar-hidden') === 'true';
  });

  // Debug mode detection
  const isDebugMode = import.meta.env.DEV || 
                     import.meta.env.VITE_SHOW_DEBUG === 'true' || 
                     new URLSearchParams(window.location.search).has('debug');

  useEffect(() => {
    if (!siteId) {
      navigate('/');
      return;
    }

    loadSite();
    checkOPFSSupport();
  }, [siteId, navigate]);

  useEffect(() => {
    if (site && iframeRef.current && !playgroundClient) {
      initializeWordPress();
    }
  }, [site, playgroundClient]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'H') {
        e.preventDefault();
        toggleBarVisibility();
      } else if (e.key === 'Escape' && isBarHidden) {
        e.preventDefault();
        showBar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBarHidden]);


  const checkOPFSSupport = async () => {
    try {
      // Use centralized helper; avoid noisy warnings for users
      const granted = await requestPersistentStorage();
      console.log('Persistent storage granted:', granted);

      // Check storage quota (debug info)
      const quota = await navigator.storage.estimate();
      console.log('Storage quota:', quota);

      // Probe OPFS access
      const opfsRoot = await navigator.storage.getDirectory();
      console.log('OPFS access successful:', opfsRoot);

      // No user-facing warning if not granted; we rely on fallbacks reliably
      if (!granted) {
        console.log('Persistent storage not granted; using fallback persistence.');
      }
    } catch (error) {
      console.error('OPFS check failed:', error);
      // Soft notice only if something is really off; no destructive variant
      toast({
        title: 'Storage support limited',
        description: 'Your browser may not fully support persistence; a fallback will be used.',
      });
    }
  };

  const loadSite = () => {
    const metadata = getSiteMetadata();
    const foundSite = metadata.sites.find(s => s.id === siteId);
    
    if (!foundSite) {
      setError('Site not found');
      setIsLoading(false);
      return;
    }

    setSite(foundSite);
    setIsLoading(false);
  };

  const initializeWordPress = async () => {
    if (!site || !iframeRef.current) return;

    setIsInitializing(true);
    setError(null);

    try {
      console.log(`Initializing WordPress for site: ${site.title} (${site.id})`);

      // Initialize WordPress Playground with OPFS persistence
      const client = await initializePlayground(
        iframeRef.current,
        site.id,
        site.isInitialized,
        site.title
      );

      setPlaygroundClient(client);

      // Wait for WordPress to fully load, then sync the site name
      setTimeout(async () => {
        try {
          const phpCode = `<?php
require_once '/wordpress/wp-load.php';
update_option('blogname', ${JSON.stringify(site.title)});
update_option('blogdescription', 'A Pootle site');
wp_cache_flush();

echo get_option('blogname');
?>`;

          const result = await client.run({ code: phpCode });
          console.log('Site name synced to WordPress:', site.title, result);

          // SQLite fallback to ensure option is updated even if WP APIs fail
          try {
            const sqliteCode = `<?php\ntry {\n  $db = new PDO('sqlite:/wordpress/wp-content/database/.ht.sqlite');\n  $stmt = $db->prepare("UPDATE wp_options SET option_value = :title WHERE option_name = 'blogname'");\n  $stmt->execute([':title' => ${JSON.stringify(site.title)}]);\n  echo 'ok';\n} catch (Exception $e) { echo 'err'; }\n?>`;
            await client.run({ code: sqliteCode });
          } catch (_) {}

          // Navigate inside the Playground to force UI refresh
          try {
            if (typeof (client as any).goTo === 'function') {
              await (client as any).goTo('/?t=' + Date.now());
            }
          } catch (navErr) {
            console.warn('Failed to refresh Playground view:', navErr);
          }
        } catch (error) {
          console.warn('Failed to sync site name after delay:', error);
        }
      }, 3000); // Wait 3 seconds for WordPress to be fully ready

      // Add diagnostics to check if mount worked (debug mode only)
      if (isDebugMode) {
        setTimeout(async () => {
          await diagnoseMountStatus(client, site.id);
        }, 3000);
      }

      if (!site.isInitialized) {
        // Mark site as initialized after first OPFS sync
        updateSite(site.id, { 
          isInitialized: true,
          lastModified: new Date().toISOString()
        });
        setSite(prev => prev ? { ...prev, isInitialized: true } : null);
        toast({
          title: 'Site ready',
          description: `${site.title} has been initialized and persisted`,
        });
        console.log('Site initialized and OPFS mounted');
      } else {
        toast({ title: 'Site loaded', description: 'Restored from OPFS' });
      }

      // Set up periodic OPFS diagnostics (debug mode only)
      if (isDebugMode) {
        const diagnosticInterval = setInterval(async () => {
          await checkOPFSContents(site.id);
        }, 60000); // Check every minute

        // Cleanup diagnostics on component unmount
        return () => {
          clearInterval(diagnosticInterval);
        };
      }

    } catch (error) {
      console.error('Failed to initialize WordPress:', error);
      setError('Failed to initialize WordPress. Please try again.');
      toast({
        title: 'Initialization failed',
        description: 'Could not start WordPress. Please check your browser compatibility.',
        variant: 'destructive',
      });
    } finally {
      setIsInitializing(false);
    }
  };

  const diagnoseMountStatus = async (client: any, siteId: string) => {
    try {
      console.log('=== OPFS Mount Diagnostics ===');
      
      // Check if client has mount info
      if (client.getMountedDirectories) {
        const mounts = await client.getMountedDirectories();
        console.log('Mounted directories:', mounts);
      }
      
      // Test if we can access the WordPress directory
      if (client.listFiles) {
        const files = await client.listFiles('/wordpress');
        console.log('WordPress directory contents:', files);
      }
      
      // Check OPFS contents directly
      await checkOPFSContents(siteId);
      
    } catch (error) {
      console.error('Mount diagnosis failed:', error);
    }
  };

  const checkOPFSContents = async (siteId: string) => {
    try {
      console.log('=== OPFS Contents Check ===');
      const opfsRoot = await navigator.storage.getDirectory();
      const sitesDir = await opfsRoot.getDirectoryHandle('wp-studio/sites', { create: false });
      const siteDir = await sitesDir.getDirectoryHandle(siteId, { create: false });
      
      console.log('Site directory exists in OPFS');
      
      // List all files in the site directory
      const entries = [];
      for await (const [name, handle] of (siteDir as any).entries()) {
        entries.push({ name, type: handle.kind });
      }
      console.log('OPFS site directory contents:', entries);
      
      // If there are files, show file sizes
      for (const entry of entries) {
        if (entry.type === 'file') {
          try {
            const fileHandle = await siteDir.getFileHandle(entry.name);
            const file = await fileHandle.getFile();
            console.log(`${entry.name}: ${file.size} bytes, modified: ${file.lastModified}`);
          } catch (e) {
            console.warn(`Could not read ${entry.name}:`, e);
          }
        }
      }
      
    } catch (error) {
      console.log('OPFS contents check failed (may be normal for new sites):', error);
    }
  };

  const forceFlushToOPFS = async () => {
    if (!playgroundClient || !site) return;
    
    try {
      console.log('=== Forcing OPFS Flush ===');
      
      // Try to trigger a manual sync if the API exists
      if (playgroundClient.flushOpfs) {
        await playgroundClient.flushOpfs();
        console.log('OPFS flush completed');
      } else if (playgroundClient.run) {
        // Force a PHP request to trigger auto-sync
        await playgroundClient.run({
          code: '<?php echo "Triggering OPFS sync"; ?>'
        });
        console.log('Triggered PHP request for OPFS sync');
      }
      
      // Check contents after flush
      setTimeout(() => checkOPFSContents(site.id), 1000);
      
      toast({
        title: 'Sync forced',
        description: 'Manually triggered OPFS synchronization',
      });
      
    } catch (error) {
      console.error('Force flush failed:', error);
      toast({
        title: 'Sync failed',
        description: 'Could not force OPFS synchronization',
        variant: 'destructive',
      });
    }
  };

  const handleManualSave = async () => {
    if (playgroundClient && site?.isInitialized) {
      await forceFlushToOPFS();
      updateSite(site.id, { lastModified: new Date().toISOString() });
    }
  };

  const handleBack = async () => {
    // No manual save needed; OPFS syncs automatically
    if (playgroundClient && site?.isInitialized) {
      updateSite(site.id, { lastModified: new Date().toISOString() });
    }
    navigate('/');
  };

  const toggleBarVisibility = () => {
    const newHiddenState = !isBarHidden;
    setIsBarHidden(newHiddenState);
    localStorage.setItem('pootle-bar-hidden', newHiddenState.toString());
  };

  const showBar = () => {
    setIsBarHidden(false);
    localStorage.setItem('pootle-bar-hidden', 'false');
  };

  const hideBar = () => {
    setIsBarHidden(true);
    localStorage.setItem('pootle-bar-hidden', 'true');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading site...</p>
        </div>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Site Not Found</h2>
          <p className="text-muted-foreground mb-4">{error || 'The requested site could not be found.'}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Visible Pootle Sites Tab */}
      {!isBarHidden && (
        <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-0.5 flex items-center gap-1 rounded-b-lg bg-card/90 backdrop-blur border border-border px-2 py-0.5 text-xs text-foreground shadow-md transition-all duration-300">
          <button
            type="button"
            className="flex items-center gap-1 hover:bg-accent hover:text-accent-foreground transition-colors rounded px-1 py-0.5"
            onClick={handleBack}
            aria-label="Back to Pootle Sites"
          >
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
            <span>Back to Pootle Sites</span>
          </button>
          <button
            type="button"
            className="ml-1 p-0.5 hover:bg-accent hover:text-accent-foreground transition-colors rounded"
            onClick={hideBar}
            aria-label="Hide bar (Shift+H to toggle, Esc to show)"
            title="Hide bar (Shift+H to toggle, Esc to show)"
          >
            <EyeOff className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Reveal Handle - only shown when bar is hidden */}
      {isBarHidden && (
        <button
          type="button"
          className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] w-16 h-1 bg-muted/50 hover:bg-muted hover:h-6 hover:rounded-b-lg hover:flex hover:items-center hover:justify-center transition-all duration-300 group"
          onClick={showBar}
          aria-label="Show navigation bar (click or press Esc)"
          title="Show navigation bar (click or press Esc)"
        >
          <Eye className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}

      {/* WordPress Playground - Takes full height */}
      <div className="flex-1 relative overflow-hidden">
        {isInitializing && (
          <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="text-center p-8 bg-card rounded-lg border shadow-lg">
              <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
              <h3 className="text-lg font-semibold mb-2">
                {site.isInitialized ? 'Loading your WordPress site...' : 'Setting up WordPress...'}
              </h3>
              <p className="text-muted-foreground text-sm">
                {site.isInitialized 
                  ? 'Restoring your content and settings' 
                  : 'This may take a few moments on first launch'
                }
              </p>
            </div>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0 block"
          title={`WordPress - ${site.title}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          style={{ 
            minHeight: '100%',
            height: '100%',
            width: '100%'
          }}
        />
      </div>
    </div>
  );
};

export default Site;