export interface StorageInfo {
  used: number;
  quota: number;
  percentage: number;
  isSupported: boolean;
  isPersistent: boolean;
}

export const getStorageInfo = async (): Promise<StorageInfo> => {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return {
      used: 0,
      quota: 0,
      percentage: 0,
      isSupported: false,
      isPersistent: false,
    };
  }

  try {
    // Force a more accurate estimate by accessing OPFS first
    try {
      await navigator.storage.getDirectory();
    } catch {}
    
    const [estimate, isPersistent] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() || Promise.resolve(false),
    ]);

    const used = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentage = quota > 0 ? (used / quota) * 100 : 0;

    return {
      used,
      quota,
      percentage,
      isSupported: true,
      isPersistent,
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return {
      used: 0,
      quota: 0,
      percentage: 0,
      isSupported: false,
      isPersistent: false,
    };
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};