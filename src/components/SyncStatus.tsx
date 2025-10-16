import { CheckCircle2, Loader2, AlertCircle, Circle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export type SyncStatusType = 'synced' | 'syncing' | 'error' | 'offline';

interface SyncStatusProps {
  status: SyncStatusType;
  lastSyncedAt?: string;
  className?: string;
}

const SyncStatus = ({ status, lastSyncedAt, className = '' }: SyncStatusProps) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'offline':
        return <Circle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'synced':
        return lastSyncedAt ? `Synced ${formatSyncTime(lastSyncedAt)}` : 'Synced';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Sync failed';
      case 'offline':
        return 'Offline';
    }
  };

  const formatSyncTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex items-center gap-1.5 ${className}`}>
            {getStatusIcon()}
            <span className="text-xs text-muted-foreground">{getStatusText()}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getStatusText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SyncStatus;
