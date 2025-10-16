import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Site } from '@/types/site';
import { syncSiteMetadata, deleteSiteFromCloud } from '@/utils/cloudSync';
import { deleteSite as deleteLocalSite } from '@/utils/storage';
import { Edit, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import SyncStatus from './SyncStatus';
import { supabase } from '@/integrations/supabase/client';

interface SiteCardProps {
  site: Site;
  onUpdate: () => void;
}

export const SiteCard = ({ site, onUpdate }: SiteCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newTitle, setNewTitle] = useState(site.title);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();

  // Load sync status from cloud
  useState(() => {
    const loadSyncStatus = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('sites')
        .select('last_synced_at')
        .eq('id', site.id)
        .eq('user_id', user.id)
        .single();
      
      if (data?.last_synced_at) {
        setLastSyncedAt(data.last_synced_at);
      }
    };
    loadSyncStatus();
  });

  const handleOpen = () => {
    console.log('Open button clicked for site:', site.id);
    console.log('Site data:', site);
    console.log('Site initialized:', site.isInitialized);
    navigate(`/site/${site.id}`);
  };

  const handleRename = async () => {
    if (!newTitle.trim() || newTitle === site.title || !user) return;
    
    try {
      const updatedSite = {
        ...site,
        title: newTitle.trim(),
        lastModified: new Date().toISOString()
      };
      
      await syncSiteMetadata(updatedSite, user.id);
      onUpdate();
      toast({
        title: 'Site renamed',
        description: `Site renamed to "${newTitle.trim()}"`,
      });
    } catch (error) {
      toast({
        title: 'Rename failed',
        description: 'Failed to rename the site',
        variant: 'destructive'
      });
    }
    setShowRenameDialog(false);
    setNewTitle(site.title);
  };

  const handleDelete = async () => {
    if (!user) return;
    
    setIsDeleting(true);
    try {
      // Delete from cloud first
      await deleteSiteFromCloud(site.id, user.id);
      // Then delete local OPFS
      await deleteLocalSite(site.id);
      
      onUpdate();
      toast({
        title: 'Site deleted',
        description: `"${site.title}" has been permanently deleted`,
      });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: 'Failed to delete the site. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      <Card className="group blueprint-card hover:shadow-blueprint transition-all duration-300 hover:-translate-y-1 hover:border-primary/30">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h3 className="font-semibold text-lg text-card-foreground mb-2 group-hover:text-primary transition-colors">
                {site.title}
              </h3>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>Created: {formatDate(site.createdAt)}</p>
                <p>Modified: {formatDate(site.lastModified)}</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${site.isInitialized ? 'bg-primary shadow-glow' : 'bg-muted'}`} />
                  <span>{site.isInitialized ? 'Ready' : 'Initializing'}</span>
                </div>
                <SyncStatus status="synced" lastSyncedAt={lastSyncedAt} />
              </div>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="p-4 pt-0 flex gap-2">
          <Button 
            onClick={handleOpen}
            className="flex-1 blueprint-button"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowRenameDialog(true)}
            className="blueprint-button-secondary hover:bg-accent/50 hover:text-accent-foreground"
          >
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowDeleteDialog(true)}
            className="blueprint-button-secondary hover:bg-destructive/50 hover:text-destructive-foreground"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </CardFooter>
      </Card>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="blueprint-card">
          <DialogHeader>
            <DialogTitle>Rename Site</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter site title"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameDialog(false)} className="blueprint-button-secondary">
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!newTitle.trim()} className="blueprint-button">
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="blueprint-card"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Site</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{site.title}"? This action cannot be undone and will permanently remove all site data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};