export interface Site {
  id: string;
  title: string;
  createdAt: string;
  lastModified: string;
  isInitialized: boolean;
}

export interface SiteMetadata {
  sites: Site[];
}