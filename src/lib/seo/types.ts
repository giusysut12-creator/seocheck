// Normalized shapes returned by any SEODataProvider implementation.
// These are provider-agnostic: a concrete adapter (e.g. SeoApiProvider) is
// responsible for mapping a specific vendor's API response into this shape.

export interface DomainOverview {
  domain: string
  domainAuthority: number | null
  seoScore: number | null
  organicTraffic: number | null
  organicKeywords: number | null
  trafficValue: number | null
  backlinks: number | null
  referringDomains: number | null
}

export interface OrganicKeywordResult {
  keyword: string
  position: number
  previousPosition: number | null
  searchVolume: number | null
  difficulty: number | null
  cpc: number | null
  estimatedTraffic: number | null
  url: string | null
  searchIntent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null
  isBranded: boolean
}

export interface KeywordMetrics {
  keyword: string
  searchVolume: number | null
  difficulty: number | null
  cpc: number | null
  searchIntent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null
}

export interface KeywordRankingPoint {
  keyword: string
  date: string
  position: number | null
  url: string | null
  serpFeatures: string[]
}

export interface CompetitorSummary {
  domain: string
  organicTraffic: number | null
  organicKeywords: number | null
  commonKeywords: number | null
  trafficValue: number | null
  visibility: number | null
}

export interface BacklinkRecord {
  sourceUrl: string
  sourceDomain: string
  targetUrl: string
  anchorText: string | null
  sourceDomainAuthority: number | null
  linkType: 'dofollow' | 'nofollow'
  firstSeen: string | null
  lastSeen: string | null
}

export interface SerpResultItem {
  position: number | null
  resultType: 'organic' | 'featured_snippet' | 'people_also_ask' | 'local_pack' | 'image_pack' | 'video' | 'shopping' | 'ai_overview'
  title: string | null
  url: string | null
  snippet: string | null
}

export interface TrafficEstimatePoint {
  date: string
  organicTraffic: number | null
  organicKeywords: number | null
  trafficValue: number | null
}

export interface ProviderQueryParams {
  country?: string
  device?: 'desktop' | 'mobile'
  limit?: number
}
