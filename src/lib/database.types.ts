// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once the project is linked
// to a live Supabase instance for a schema-verified source of truth.

export type Device = 'desktop' | 'mobile'
export type Plan = 'free' | 'starter' | 'pro' | 'agency'
export type SearchIntent = 'informational' | 'navigational' | 'commercial' | 'transactional'
export type AuditStatus = 'pending' | 'crawling' | 'completed' | 'failed'
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low'
export type IssueCategory = 'technical' | 'onpage' | 'performance' | 'indexability' | 'content' | 'backlinks'
export type OpportunityCategory = 'quick_win' | 'content' | 'keyword' | 'technical' | 'internal_linking' | 'backlink'
export type OpportunityImpact = 'high' | 'medium' | 'low'
export type LinkType = 'dofollow' | 'nofollow'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  plan: Plan
  monthly_crawl_limit: number
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  user_id: string
  name: string
  domain: string
  country: string
  device: Device
  search_engine: string
  created_at: string
  updated_at: string
}

export interface Domain {
  id: string
  project_id: string
  domain: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface DomainMetric {
  id: string
  domain_id: string
  date: string
  seo_score: number | null
  domain_authority: number | null
  organic_traffic: number | null
  organic_keywords: number | null
  traffic_value: number | null
  backlinks: number | null
  referring_domains: number | null
  source: 'provider' | 'crawler'
  created_at: string
  updated_at: string
}

export interface Keyword {
  id: string
  project_id: string
  domain_id: string | null
  keyword: string
  country: string
  device: Device
  search_volume: number | null
  difficulty: number | null
  cpc: number | null
  search_intent: SearchIntent | null
  is_branded: boolean
  is_tracked: boolean
  source: 'provider' | 'manual'
  created_at: string
  updated_at: string
}

export interface KeywordRanking {
  id: string
  keyword_id: string
  date: string
  position: number | null
  previous_position: number | null
  best_position: number | null
  url: string | null
  serp_features: string[]
  traffic_estimate: number | null
  created_at: string
  updated_at: string
}

export interface Page {
  id: string
  project_id: string
  domain_id: string | null
  url: string
  title: string | null
  meta_description: string | null
  h1: string | null
  h1_count: number
  h2_count: number
  canonical: string | null
  robots_meta: string | null
  status_code: number | null
  redirect_url: string | null
  is_indexable: boolean
  is_https: boolean
  word_count: number | null
  internal_links_count: number
  external_links_count: number
  images_missing_alt_count: number
  load_time_ms: number | null
  is_orphan: boolean
  last_crawled_at: string | null
  created_at: string
  updated_at: string
}

export interface PageMetric {
  id: string
  page_id: string
  date: string
  organic_traffic: number | null
  keywords_count: number | null
  top_keyword: string | null
  avg_position: number | null
  traffic_value: number | null
  created_at: string
  updated_at: string
}

export interface Competitor {
  id: string
  project_id: string
  domain: string
  is_auto_detected: boolean
  organic_traffic: number | null
  organic_keywords: number | null
  common_keywords: number | null
  traffic_value: number | null
  visibility: number | null
  created_at: string
  updated_at: string
}

export interface CompetitorKeyword {
  id: string
  competitor_id: string
  keyword_id: string | null
  keyword: string
  competitor_position: number | null
  your_position: number | null
  url: string | null
  search_volume: number | null
  gap_type: 'missing' | 'weaker' | 'common' | 'stronger' | null
  created_at: string
  updated_at: string
}

export interface Backlink {
  id: string
  project_id: string
  domain_id: string | null
  source_url: string
  source_domain: string
  target_url: string
  anchor_text: string | null
  source_domain_authority: number | null
  link_type: LinkType
  status: 'active' | 'lost' | 'new'
  first_seen: string | null
  last_seen: string | null
  created_at: string
  updated_at: string
}

export interface ReferringDomain {
  id: string
  project_id: string
  domain_id: string | null
  referring_domain: string
  domain_authority: number | null
  backlinks_count: number
  first_seen: string | null
  last_seen: string | null
  created_at: string
  updated_at: string
}

export interface SiteAudit {
  id: string
  project_id: string
  domain_id: string | null
  status: AuditStatus
  urls_total: number
  urls_crawled: number
  urls_errored: number
  seo_score: number | null
  technical_score: number | null
  onpage_score: number | null
  performance_score: number | null
  indexability_score: number | null
  content_score: number | null
  backlinks_score: number | null
  critical_count: number
  warning_count: number
  passed_count: number
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface AuditIssue {
  id: string
  site_audit_id: string
  project_id: string
  issue_type: string
  category: IssueCategory
  priority: IssuePriority
  title: string
  description: string
  why_it_matters: string
  how_to_fix: string
  affected_urls: string[]
  affected_count: number
  status: 'open' | 'resolved' | 'ignored'
  created_at: string
  updated_at: string
}

export interface SerpResult {
  id: string
  project_id: string
  keyword_id: string | null
  date: string
  result_type: 'organic' | 'featured_snippet' | 'people_also_ask' | 'local_pack' | 'image_pack' | 'video' | 'shopping' | 'ai_overview'
  position: number | null
  title: string | null
  url: string | null
  snippet: string | null
  raw_data: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface SeoOpportunity {
  id: string
  project_id: string
  keyword_id: string | null
  page_id: string | null
  category: OpportunityCategory
  title: string
  description: string
  current_position: number | null
  search_volume: number | null
  difficulty: number | null
  potential_impact: OpportunityImpact | null
  opportunity_score: number
  recommended_actions: string[]
  status: 'open' | 'in_progress' | 'done' | 'dismissed'
  created_at: string
  updated_at: string
}

export interface Report {
  id: string
  project_id: string
  user_id: string
  title: string
  period_start: string | null
  period_end: string | null
  data: Record<string, unknown>
  status: 'generating' | 'ready' | 'failed'
  created_at: string
  updated_at: string
}
