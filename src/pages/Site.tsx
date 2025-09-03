import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, ExternalLink, Plus } from 'lucide-react';
import { getSiteMetadata, updateSite } from '@/utils/storage';
import { syncMemfsToOPFS, syncOPFSToMemfs } from '@/utils/playground';
import { Site as SiteType } from '@/types/site';
import { useToast } from '@/hooks/use-toast';

const Site = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [site, setSite] = useState<SiteType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wordpressWindow, setWordpressWindow] = useState<Window | null>(null);

  useEffect(() => {
    if (!siteId) {
      navigate('/');
      return;
    }

    loadSite();
  }, [siteId, navigate]);

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

  const openWordPressInNewTab = async () => {
    if (!site) return;

    setIsInitializing(true);
    setError(null);

    try {
      console.log(`Opening WordPress for site: ${site.title} (${site.id})`);

      // Create a new window for WordPress Playground
      const newWindow = window.open('', `wordpress-${site.id}`, 'width=1400,height=900,scrollbars=yes,resizable=yes');
      
      if (!newWindow) {
        throw new Error('Failed to open new window. Please allow popups for this site.');
      }

      setWordpressWindow(newWindow);

      // Set up the HTML for WordPress Playground using the playground.wordpress.net URL directly
      const playgroundUrl = new URL('https://playground.wordpress.net/');
      
      // Add configuration parameters
      playgroundUrl.searchParams.set('blueprint', JSON.stringify({
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
      }));

      // Navigate to WordPress Playground
      newWindow.location.href = playgroundUrl.toString();

      // Set up polling to check if window is ready
      let checkCount = 0;
      const maxChecks = 30; // 30 seconds max wait time
      
      const checkPlayground = () => {
        checkCount++;
        
        if (newWindow.closed) {
          console.log('WordPress window was closed by user');
          setWordpressWindow(null);
          setIsInitializing(false);
          return;
        }
        
        if (checkCount >= maxChecks) {
          console.log('WordPress Playground took too long to load');
          setIsInitializing(false);
          toast({
            title: 'WordPress ready',
            description: `${site.title} should be loading in the new tab`,
          });
          return;
        }

        try {
          // Try to access the window to see if it's loaded
          const href = newWindow.location.href;
          if (href && href.includes('playground.wordpress.net')) {
            console.log('WordPress Playground loaded successfully');
            
            // Mark site as initialized if it's the first time
            if (!site.isInitialized) {
              updateSite(site.id, { 
                isInitialized: true,
                lastModified: new Date().toISOString()
              });
              
              setSite(prev => prev ? { ...prev, isInitialized: true } : null);
              
              toast({
                title: 'WordPress ready',
                description: `${site.title} has been set up and opened in a new tab`,
              });
            } else {
              toast({
                title: 'WordPress opened',
                description: `${site.title} is ready in the new tab`,
              });
            }
            
            setIsInitializing(false);
            return;
          }
        } catch (e) {
          // Cross-origin error expected until playground loads
        }
        
        // Continue checking
        setTimeout(checkPlayground, 1000);
      };

      // Start checking after a short delay
      setTimeout(checkPlayground, 2000);

      // Clean up when window is closed
      const checkClosed = setInterval(() => {
        if (newWindow.closed) {
          clearInterval(checkClosed);
          setWordpressWindow(null);
          console.log('WordPress window closed');
        }
      }, 1000);

    } catch (error) {
      console.error('Failed to open WordPress:', error);
      setError('Failed to open WordPress. Please try again.');
      setIsInitializing(false);
      toast({
        title: 'Failed to open WordPress',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  };

  const handleBack = () => {
    // Close WordPress window if open
    if (wordpressWindow && !wordpressWindow.closed) {
      wordpressWindow.close();
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
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleBack}
                className="hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </div>
            
            <div className="text-center flex-1">
              <h1 className="text-2xl font-bold text-foreground">{site.title}</h1>
              <p className="text-sm text-muted-foreground">
                {site.isInitialized ? 'WordPress Site Ready' : 'Setting up WordPress...'}
              </p>
            </div>

            <div className="flex items-center gap-2">
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto text-center">
          {/* Site Status Card */}
          <div className="bg-card rounded-lg border border-border/50 shadow-card p-8 mb-8">
            <div className="mb-6">
              <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
                site.isInitialized ? 'bg-gradient-primary' : 'bg-muted'
              }`}>
                <ExternalLink className={`w-8 h-8 ${
                  site.isInitialized ? 'text-primary-foreground' : 'text-muted-foreground'
                }`} />
              </div>
              
              <h2 className="text-xl font-semibold mb-2 text-card-foreground">
                {site.isInitialized ? 'WordPress Ready' : 'Setting Up WordPress'}
              </h2>
              
              <p className="text-muted-foreground mb-6">
                {site.isInitialized 
                  ? 'Your WordPress site is ready. Click below to open it in a new tab.'
                  : 'WordPress is being set up for the first time. This may take a few moments.'
                }
              </p>
              
              {isInitializing && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Opening WordPress in new tab...
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Button 
                onClick={openWordPressInNewTab}
                disabled={isInitializing}
                size="lg"
                className="bg-gradient-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-elegant"
              >
                {isInitializing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Opening WordPress...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Open WordPress in New Tab
                  </>
                )}
              </Button>
              
              {wordpressWindow && !wordpressWindow.closed && (
                <p className="text-sm text-primary">
                  WordPress is open in a new tab
                </p>
              )}
            </div>
          </div>

          {/* Site Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
            <div className="bg-card rounded-lg border border-border/50 p-6">
              <h3 className="font-semibold mb-2 text-card-foreground">Site Details</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><span className="font-medium">Created:</span> {new Date(site.createdAt).toLocaleDateString()}</p>
                <p><span className="font-medium">Last Modified:</span> {new Date(site.lastModified).toLocaleDateString()}</p>
                <p><span className="font-medium">Status:</span> {site.isInitialized ? 'Active' : 'Setting up'}</p>
              </div>
            </div>
            
            <div className="bg-card rounded-lg border border-border/50 p-6">
              <h3 className="font-semibold mb-2 text-card-foreground">WordPress Info</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><span className="font-medium">Username:</span> admin</p>
                <p><span className="font-medium">Password:</span> password</p>
                <p><span className="font-medium">Version:</span> Latest</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Site;