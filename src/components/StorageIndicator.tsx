import { useState, useEffect } from 'react';
import { HardDrive } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getStorageInfo, formatBytes, type StorageInfo } from '@/utils/storage-info';

export const StorageIndicator = () => {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    const updateStorageInfo = async () => {
      const info = await getStorageInfo();
      if (info.isSupported) {
        setStorageInfo(info);
      }
    };

    updateStorageInfo();
    
    // Update every 60 seconds
    const interval = setInterval(updateStorageInfo, 60000);
    
    return () => clearInterval(interval);
  }, []);

  if (!storageInfo?.isSupported) {
    return null;
  }

  const getVariant = () => {
    if (storageInfo.percentage >= 90) return 'destructive';
    if (storageInfo.percentage >= 80) return 'warning';
    return 'default';
  };

  const formatPercentage = (p: number) => {
    if (p >= 10) return `${Math.round(p)}%`;
    if (p >= 1) return `${p.toFixed(1)}%`;
    if (p > 0) return '<1%';
    return '0%';
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50 hover:bg-muted/70 transition-colors">
          <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="w-12 h-1.5">
            <Progress 
              value={storageInfo.percentage} 
              className="h-1.5"
            />
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {formatPercentage(storageInfo.percentage)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <div className="space-y-1 text-sm">
          <div className="font-medium">Local Storage Usage</div>
          <div>
            <span className="text-muted-foreground">Used:</span> {formatBytes(storageInfo.used)}
          </div>
          <div>
            <span className="text-muted-foreground">Total:</span> {formatBytes(storageInfo.quota)}
          </div>
          <div>
            <span className="text-muted-foreground">Available:</span> {formatBytes(Math.max(storageInfo.quota - storageInfo.used, 0))}
          </div>
          <div>
            <span className="text-muted-foreground">Percentage:</span> {formatPercentage(storageInfo.percentage)}
          </div>
          {storageInfo.isPersistent && (
            <div className="text-xs text-green-600 dark:text-green-400">
              ✓ Persistent storage enabled
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};