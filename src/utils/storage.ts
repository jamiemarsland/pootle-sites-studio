import { Site, SiteMetadata } from '../types/site';

const STORAGE_KEY = 'pootle-sites';
const SITES_ROOT_DIR = 'wp-studio/sites';

// Request persistent storage permission
export const requestPersistentStorage = async (): Promise<boolean> => {
  if ('storage' in navigator && 'persist' in navigator.storage) {
    try {
      // Check if already persistent
      const isPersistent = await navigator.storage.persisted();
      if (isPersistent) {
        console.log('Storage is already persistent');
        return true;
      }
      
      const granted = await navigator.storage.persist();
      console.log('Persistent storage request result:', granted);
      
      // Don't show warnings in production - localStorage is reliable enough
      if (!granted) {
        console.log('Persistent storage not granted, using localStorage fallback');
      }
      
      return granted;
    } catch (error) {
      console.log('Persistent storage API not fully supported, using localStorage fallback');
      return false;
    }
  }
  console.log('Persistent storage API not available, using localStorage fallback');
  return false;
};

// Get all site metadata from localStorage
export const getSiteMetadata = (): SiteMetadata => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { sites: [] };
  } catch (error) {
    console.error('Failed to load site metadata:', error);
    return { sites: [] };
  }
};

// Save site metadata to localStorage
export const saveSiteMetadata = (metadata: SiteMetadata): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.error('Failed to save site metadata:', error);
  }
};

// Add a new site
export const addSite = (site: Site): void => {
  const metadata = getSiteMetadata();
  metadata.sites.push(site);
  saveSiteMetadata(metadata);
};

// Update an existing site
export const updateSite = (siteId: string, updates: Partial<Site>): void => {
  const metadata = getSiteMetadata();
  const siteIndex = metadata.sites.findIndex(site => site.id === siteId);
  if (siteIndex !== -1) {
    metadata.sites[siteIndex] = { ...metadata.sites[siteIndex], ...updates };
    saveSiteMetadata(metadata);
  }
};

// Delete a site
export const deleteSite = async (siteId: string): Promise<void> => {
  // Remove from metadata
  const metadata = getSiteMetadata();
  metadata.sites = metadata.sites.filter(site => site.id !== siteId);
  saveSiteMetadata(metadata);

  // Remove OPFS directory
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const sitesDir = await opfsRoot.getDirectoryHandle(SITES_ROOT_DIR, { create: false });
    await sitesDir.removeEntry(siteId, { recursive: true });
    console.log(`Deleted OPFS directory for site: ${siteId}`);
  } catch (error) {
    console.error(`Failed to delete OPFS directory for site ${siteId}:`, error);
  }
};

// Generate unique site ID
export const generateSiteId = (): string => {
  return crypto.randomUUID();
};

// Get OPFS directory for a site
export const getSiteOPFSDirectory = async (siteId: string): Promise<FileSystemDirectoryHandle> => {
  const opfsRoot = await navigator.storage.getDirectory();
  const sitesDir = await opfsRoot.getDirectoryHandle(SITES_ROOT_DIR, { create: true });
  return await sitesDir.getDirectoryHandle(siteId, { create: true });
};