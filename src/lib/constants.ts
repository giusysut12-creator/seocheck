export const COUNTRIES = [
  { code: 'US', label: 'Stati Uniti' },
  { code: 'GB', label: 'Regno Unito' },
  { code: 'IT', label: 'Italia' },
  { code: 'DE', label: 'Germania' },
  { code: 'FR', label: 'Francia' },
  { code: 'ES', label: 'Spagna' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'BR', label: 'Brasile' },
  { code: 'NL', label: 'Paesi Bassi' },
] as const

export const SEARCH_ENGINES = [{ code: 'google', label: 'Google' }] as const

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '' },
  { key: 'audit', label: 'Controllo del sito', path: 'audit' },
  { key: 'rankings', label: 'Posizionamento', path: 'rankings' },
  { key: 'keywords', label: 'Parole chiave', path: 'keywords' },
  { key: 'competitors', label: 'Concorrenti', path: 'competitors' },
  { key: 'backlinks', label: 'Backlink', path: 'backlinks' },
  { key: 'traffic', label: 'Traffico', path: 'traffic' },
  { key: 'pages', label: 'Pagine', path: 'pages' },
  { key: 'opportunities', label: 'Opportunità SEO', path: 'opportunities' },
  { key: 'reports', label: 'Report', path: 'reports' },
] as const
