import type {
  BacklinkRecord,
  CompetitorSummary,
  DomainOverview,
  KeywordMetrics,
  KeywordRankingPoint,
  OrganicKeywordResult,
  ProviderQueryParams,
  SerpResultItem,
  TrafficEstimatePoint,
} from '@/lib/seo/types'

/**
 * Abstract SEO data provider. Every method that needs third-party keyword,
 * ranking, competitor, backlink, SERP or traffic data goes through this
 * interface so the app is never hard-wired to one vendor. Swap the
 * implementation (see SeoApiProvider) without touching any page component.
 */
export interface SEODataProvider {
  readonly isConfigured: boolean
  getDomainOverview(domain: string, params?: ProviderQueryParams): Promise<DomainOverview | null>
  getOrganicKeywords(domain: string, params?: ProviderQueryParams): Promise<OrganicKeywordResult[]>
  getKeywordData(keyword: string, params?: ProviderQueryParams): Promise<KeywordMetrics | null>
  getKeywordRankings(domain: string, keywords: string[], params?: ProviderQueryParams): Promise<KeywordRankingPoint[]>
  getCompetitors(domain: string, params?: ProviderQueryParams): Promise<CompetitorSummary[]>
  getBacklinks(domain: string, params?: ProviderQueryParams): Promise<BacklinkRecord[]>
  getSerpResults(keyword: string, params?: ProviderQueryParams): Promise<SerpResultItem[]>
  getTrafficEstimate(domain: string, params?: ProviderQueryParams): Promise<TrafficEstimatePoint[]>
}

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super('SEO data provider is not configured')
    this.name = 'ProviderNotConfiguredError'
  }
}
