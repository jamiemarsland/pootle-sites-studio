import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SiteCard } from '@/components/SiteCard';
import { Site } from '@/types/site';
import { getSiteMetadata, addSite, generateSiteId, requestPersistentStorage } from '@/utils/storage';
import { Plus, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import heroImage from '@/assets/pootle-hero.jpg';

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [showNewSiteDialog, setShowNewSiteDialog] = useState(false);
  const [newSiteTitle, setNewSiteTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadSites();
    requestPersistentStorage();
  }, []);

  const loadSites = () => {
    const metadata = getSiteMetadata();
    setSites(metadata.sites);
  };

  const handleCreateSite = async () => {
    if (!newSiteTitle.trim()) return;

    setIsCreating(true);
    try {
      const siteId = generateSiteId();
      const newSite: Site = {
        id: siteId,
        title: newSiteTitle.trim(),
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        isInitialized: false // Fresh site; will install WP then sync memfs -> OPFS on first open
      };

      addSite(newSite);
      loadSites();
      
      toast({
        title: 'Site created',
        description: `"${newSite.title}" has been created successfully`,
      });

      setShowNewSiteDialog(false);
      setNewSiteTitle('');
      
      // Navigate to the new site
      navigate(`/site/${siteId}`);
    } catch (error) {
      toast({
        title: 'Creation failed',
        description: 'Failed to create the site. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-blueprint-dark blueprint-bg">
      {/* Header */}
      <header className="border-b border-border/30 bg-card/80 backdrop-blur-md sticky top-0 z-10 shadow-blueprint">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Pootle Sites
                </h1>
                <p className="text-xs text-muted-foreground">WordPress Studio</p>
              </div>
            </div>
            <Button 
              onClick={() => setShowNewSiteDialog(true)}
              className="blueprint-button"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Site
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {sites.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16">
            <div className="relative mx-auto mb-8 w-64 h-36 rounded-lg overflow-hidden blueprint-card">
              <img 
                src={heroImage} 
                alt="Pootle Sites" 
                className="w-full h-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-primary/20" />
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Welcome to Pootle Sites
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto">
              Create and manage multiple WordPress sites with full persistence. 
              Each site runs locally in your browser with WordPress Playground.
            </p>
            <Button 
              onClick={() => setShowNewSiteDialog(true)}
              size="lg"
              className="blueprint-button text-lg px-8 py-4"
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Your First Site
            </Button>
          </div>
        ) : (
          /* Sites Grid */
          <div>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Your Sites</h2>
                <p className="text-muted-foreground">
                  {sites.length} site{sites.length !== 1 ? 's' : ''} created
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sites
                .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
                .map((site) => (
                  <SiteCard 
                    key={site.id} 
                    site={site} 
                    onUpdate={loadSites}
                  />
                ))}
            </div>
          </div>
        )}
      </main>

      {/* New Site Dialog */}
      <Dialog open={showNewSiteDialog} onOpenChange={setShowNewSiteDialog}>
        <DialogContent className="blueprint-card"
        >
          <DialogHeader>
            <DialogTitle>Create New Site</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newSiteTitle}
              onChange={(e) => setNewSiteTitle(e.target.value)}
              placeholder="Enter site title (e.g., My Blog, Portfolio)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateSite();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowNewSiteDialog(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateSite} 
              disabled={!newSiteTitle.trim() || isCreating}
              className="blueprint-button"
            >
              {isCreating ? 'Creating...' : 'Create Site'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;