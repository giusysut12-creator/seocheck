export const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'IT', label: 'Italy' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'BR', label: 'Brazil' },
  { code: 'NL', label: 'Netherlands' },
] as const

export const SEARCH_ENGINES = [{ code: 'google', label: 'Google' }] as const

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '' },
  { key: 'audit', label: 'Site Audit', path: 'audit' },
  { key: 'rankings', label: 'Rank Tracking', path: 'rankings' },
  { key: 'keywords', label: 'Keywords', path: 'keywords' },
  { key: 'competitors', label: 'Competitors', path: 'competitors' },
  { key: 'backlinks', label: 'Backlinks', path: 'backlinks' },
  { key: 'traffic', label: 'Traffic', path: 'traffic' },
  { key: 'pages', label: 'Pages', path: 'pages' },
  { key: 'opportunities', label: 'SEO Opportunities', path: 'opportunities' },
  { key: 'reports', label: 'Reports', path: 'reports' },
] as const
