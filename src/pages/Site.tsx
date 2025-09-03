import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, ExternalLink, Plus } from 'lucide-react';
import { getSiteMetadata, updateSite } from '@/utils/storage';
import { initializePlayground, syncMemfsToOPFS, syncOPFSToMemfs } from '@/utils/playground';
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

  useEffect(() => {
    if (!siteId) {
      navigate('/');
      return;
    }

    loadSite();
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

      // Initialize WordPress Playground
      const client = await initializePlayground(
        iframeRef.current,
        site.id,
        () => {
          console.log('WordPress Playground is ready');
        }
      );

      setPlaygroundClient(client);

      // If site is already initialized, load from OPFS
      if (site.isInitialized) {
        console.log('Loading existing site data from OPFS...');
        try {
          await syncOPFSToMemfs(client, site.id);
          console.log('Site data loaded successfully');
          toast({
            title: 'Site loaded',
            description: 'Your previous content has been restored',
          });
        } catch (error) {
          console.error('Failed to load site data:', error);
          toast({
            title: 'Warning',
            description: 'Could not load previous site data. Starting fresh.',
            variant: 'destructive',
          });
        }
      } else {
        // First time setup - wait for WordPress to install, then save
        console.log('First time setup - WordPress will install...');
        
        // Wait for WordPress to fully install
        setTimeout(async () => {
          try {
            await syncMemfsToOPFS(client, site.id);
            
            // Mark site as initialized
            updateSite(site.id, { 
              isInitialized: true,
              lastModified: new Date().toISOString()
            });
            
            setSite(prev => prev ? { ...prev, isInitialized: true } : null);
            
            toast({
              title: 'Site ready',
              description: `${site.title} has been initialized and is ready to use`,
            });
            
            console.log('Site initialized and saved to OPFS');
          } catch (error) {
            console.error('Failed to save initial site data:', error);
            toast({
              title: 'Save failed',
              description: 'Could not save site data. Changes may not persist.',
              variant: 'destructive',
            });
          }
        }, 15000); // Wait 15 seconds for WordPress to install
      }

      // Set up auto-save every 30 seconds
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      
      autoSaveIntervalRef.current = setInterval(async () => {
        if (client && site.isInitialized) {
          try {
            await syncMemfsToOPFS(client, site.id);
            updateSite(site.id, { lastModified: new Date().toISOString() });
            console.log('Auto-saved site data');
          } catch (error) {
            console.error('Auto-save failed:', error);
          }
        }
      }, 30000);

      // Save on page unload
      const handleBeforeUnload = async () => {
        if (client && site.isInitialized) {
          try {
            await syncMemfsToOPFS(client, site.id);
            updateSite(site.id, { lastModified: new Date().toISOString() });
            console.log('Saved on page unload');
          } catch (error) {
            console.error('Failed to save on unload:', error);
          }
        }
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      // Cleanup function
      return () => {
        if (autoSaveIntervalRef.current) {
          clearInterval(autoSaveIntervalRef.current);
        }
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };

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

  const handleManualSave = async () => {
    if (playgroundClient && site?.isInitialized) {
      try {
        await syncMemfsToOPFS(playgroundClient, site.id);
        updateSite(site.id, { lastModified: new Date().toISOString() });
        toast({
          title: 'Site saved',
          description: 'Your changes have been saved successfully',
        });
        console.log('Manual save completed');
      } catch (error) {
        console.error('Manual save failed:', error);
        toast({
          title: 'Save failed',
          description: 'Could not save your changes. Please try again.',
          variant: 'destructive',
        });
      }
    }
  };

  const handleBack = async () => {
    // Save before leaving
    if (playgroundClient && site?.isInitialized) {
      try {
        await syncMemfsToOPFS(playgroundClient, site.id);
        updateSite(site.id, { lastModified: new Date().toISOString() });
        console.log('Saved before leaving');
      } catch (error) {
        console.error('Failed to save before leaving:', error);
      }
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="bg-card border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleBack}
          className="hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        
        <div className="flex-1">
          <h1 className="font-semibold text-foreground">{site.title}</h1>
        </div>

        <div className="flex items-center gap-2">
          {playgroundClient && site?.isInitialized && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManualSave}
              className="hover:bg-accent hover:text-accent-foreground"
            >
              Save Changes
            </Button>
          )}
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/')}
            className="hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Site
          </Button>
        </div>

        {isInitializing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {site.isInitialized ? 'Loading site...' : 'Installing WordPress...'}
          </div>
        )}
      </header>

      {/* WordPress Playground */}
      <div className="flex-1 relative">
        {isInitializing && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
              <h3 className="text-lg font-semibold mb-2">
                {site.isInitialized ? 'Loading your WordPress site...' : 'Setting up WordPress...'}
              </h3>
              <p className="text-muted-foreground">
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
          className="w-full h-full border-0"
          title={`WordPress - ${site.title}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  );
};

export default Site;