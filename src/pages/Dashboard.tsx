import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SiteCard } from '@/components/SiteCard';
import { useAuth } from '@/contexts/AuthContext';
import { Site } from '@/types/site';
import { generateSiteId, requestPersistentStorage } from '@/utils/storage';
import { loadSitesFromCloud, syncSiteMetadata, initialCloudSync } from '@/utils/cloudSync';
import { Plus, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, signOut } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [showNewSiteDialog, setShowNewSiteDialog] = useState(false);
  const [newSiteTitle, setNewSiteTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialSynced, setHasInitialSynced] = useState(false);

  useEffect(() => {
    loadSites();
    requestPersistentStorage();
  }, [user]);

  const loadSites = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      // Load sites from cloud
      const cloudSites = await loadSitesFromCloud(user.id);
      setSites(cloudSites);

      // On first load, sync cloud sites to local OPFS
      if (!hasInitialSynced && cloudSites.length > 0) {
        await initialCloudSync(user.id);
        setHasInitialSynced(true);
      }
    } catch (error) {
      console.error('Failed to load sites:', error);
      toast({
        title: 'Failed to load sites',
        description: 'Could not sync sites from cloud',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSite = async () => {
    if (!newSiteTitle.trim() || !user) return;

    setIsCreating(true);
    try {
      const siteId = generateSiteId();
      const newSite: Site = {
        id: siteId,
        title: newSiteTitle.trim(),
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        isInitialized: false
      };

      // Sync to cloud immediately
      await syncSiteMetadata(newSite, user.id);
      await loadSites();
      
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

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-gradient-blueprint-dark blueprint-bg">
      {/* Header */}
      <header className="border-b border-border/30 bg-card/80 backdrop-blur-md sticky top-0 z-10 shadow-blueprint">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Pootle Sites
                </h1>
                <p className="text-xs text-muted-foreground">A WordPress Playground experiment</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {sites.length > 0 && (
                <Button 
                  onClick={() => setShowNewSiteDialog(true)}
                  className="blueprint-button"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Site
                </Button>
              )}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="blueprint-button-secondary">
                    {user?.email}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    {user?.email}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">Loading your sites...</p>
          </div>
        ) : sites.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16">
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