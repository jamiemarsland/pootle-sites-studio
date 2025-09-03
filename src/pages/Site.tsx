import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, ExternalLink, Plus } from 'lucide-react';
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

      // Initialize WordPress Playground with OPFS persistence
      const client = await initializePlayground(
        iframeRef.current,
        site.id,
        site.isInitialized
      );

      setPlaygroundClient(client);

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

      // With OPFS mounted at /wordpress, Playground automatically syncs the
      // filesystem at the end of every PHP request. No manual saves required.

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
      updateSite(site.id, { lastModified: new Date().toISOString() });
      toast({
        title: 'Saved',
        description: 'Changes are persisted automatically to OPFS.',
      });
      console.log('Manual save triggered (OPFS auto-sync)');
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
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Top Bar - Minimal height */}
      <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 shrink-0 h-16">
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
          {playgroundClient && site?.isInitialized && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleManualSave}
              className="hover:bg-accent hover:text-accent-foreground"
            >
              Save
            </Button>
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