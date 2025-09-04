import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, ExternalLink, Plus, ChevronDown } from 'lucide-react';
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
  const [chromeHidden, setChromeHidden] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    // Auto-hide chrome when WordPress is loaded
    if (playgroundClient && site?.isInitialized && !isInitializing) {
      const timer = setTimeout(() => {
        setChromeHidden(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [playgroundClient, site?.isInitialized, isInitializing]);

  useEffect(() => {
    // Keyboard shortcut to toggle chrome (Escape key)
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setChromeHidden(prev => !prev);
        clearHideTimeout();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      clearHideTimeout();
    };
  }, []);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handleChromeMouseEnter = () => {
    clearHideTimeout();
    setChromeHidden(false);
  };

  const handleChromeMouseLeave = () => {
    if (playgroundClient && site?.isInitialized) {
      hideTimeoutRef.current = setTimeout(() => {
        setChromeHidden(true);
      }, 2000);
    }
  };

  const handleRevealStripHover = () => {
    setChromeHidden(false);
    clearHideTimeout();
  };

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
        site.isInitialized
      );

      setPlaygroundClient(client);

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
    <div className="h-screen bg-background flex flex-col overflow-hidden relative">
      {/* Reveal Strip - Invisible hover area at top */}
      <div 
        className={`absolute top-0 left-0 right-0 h-2 z-50 cursor-pointer ${chromeHidden ? 'bg-gradient-to-b from-foreground/10 to-transparent' : ''}`}
        onMouseEnter={handleRevealStripHover}
        title="Hover to show controls (or press Escape)"
      />

      {/* Visible Reveal Tab */}
      {chromeHidden && !isInitializing && (
        <button
          type="button"
          className="fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-0.5 flex items-center gap-1 rounded-b-lg bg-card/90 backdrop-blur border border-border px-2 py-0.5 text-xs text-foreground shadow-md hover:bg-accent hover:text-accent-foreground transition-colors"
          onMouseEnter={handleRevealStripHover}
          onClick={handleBack}
          aria-label="Back to Pootle Sites"
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
          <span>Back to Pootle Sites</span>
        </button>
      )}

      
      {/* Top Bar - Auto-hiding with smooth transitions */}
      <header 
        className={`bg-card border-b border-border px-4 py-3 flex items-center gap-3 shrink-0 h-16 fixed top-0 left-0 right-0 z-40 transition-all duration-300 ease-out ${
          chromeHidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
        }`}
        onMouseEnter={handleChromeMouseEnter}
        onMouseLeave={handleChromeMouseLeave}
      >
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleBack}
          className="hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-foreground truncate">{site.title}</h1>
        </div>

        <div className="flex items-center gap-2">
          {playgroundClient && site?.isInitialized && isDebugMode && (
            <>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleManualSave}
                className="hover:bg-accent hover:text-accent-foreground"
              >
                Force Sync
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => checkOPFSContents(site.id)}
                className="hover:bg-accent hover:text-accent-foreground"
              >
                Check OPFS
              </Button>
            </>
          )}
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/')}
            className="hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            New
          </Button>
        </div>

        {isInitializing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {site.isInitialized ? 'Loading...' : 'Installing...'}
          </div>
        )}
      </header>

      {/* WordPress Playground - Takes remaining height */}
      <div className={`flex-1 relative overflow-hidden transition-all duration-300 ease-out ${
        chromeHidden ? 'mt-0' : 'mt-16'
      }`}>
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