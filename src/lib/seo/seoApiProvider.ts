import { supabase } from '@/lib/supabase'
import type { SEODataProvider } from '@/lib/seo/provider'
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

type ProxyAction =
  | 'domain_overview'
  | 'organic_keywords'
  | 'keyword_data'
  | 'keyword_rankings'
  | 'competitors'
  | 'backlinks'
  | 'serp_results'
  | 'traffic_estimate'

interface ProxyResponse<T> {
  configured: boolean
  data?: T
  error?: string
}

let configuredCache: boolean | null = null

async function callProxy<T>(action: ProxyAction, params: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke<ProxyResponse<T>>('seo-provider-proxy', {
    body: { action, params },
  })
  if (error) throw new Error(error.message)
  if (!data) return null
  configuredCache = data.configured
  if (!data.configured) return null
  if (data.error) throw new Error(data.error)
  return data.data ?? null
}

/**
 * Client-side implementation of SEODataProvider. It never talks to the
 * upstream vendor directly — every call is proxied through the
 * `seo-provider-proxy` Supabase Edge Function so SEO_API_KEY / SEO_API_URL
 * stay server-side secrets. If the provider isn't configured, every method
 * resolves to an empty/null result rather than inventing data.
 */
export class SeoApiProvider implements SEODataProvider {
  get isConfigured(): boolean {
    return configuredCache ?? true
  }

  async getDomainOverview(domain: string, params?: ProviderQueryParams) {
    return callProxy<DomainOverview>('domain_overview', { domain, ...params })
  }

  async getOrganicKeywords(domain: string, params?: ProviderQueryParams) {
    return (await callProxy<OrganicKeywordResult[]>('organic_keywords', { domain, ...params })) ?? []
  }

  async getKeywordData(keyword: string, params?: ProviderQueryParams) {
    return callProxy<KeywordMetrics>('keyword_data', { keyword, ...params })
  }

  async getKeywordRankings(domain: string, keywords: string[], params?: ProviderQueryParams) {
    return (await callProxy<KeywordRankingPoint[]>('keyword_rankings', { domain, keywords, ...params })) ?? []
  }

  async getCompetitors(domain: string, params?: ProviderQueryParams) {
    return (await callProxy<CompetitorSummary[]>('competitors', { domain, ...params })) ?? []
  }

  async getBacklinks(domain: string, params?: ProviderQueryParams) {
    return (await callProxy<BacklinkRecord[]>('backlinks', { domain, ...params })) ?? []
  }

  async getSerpResults(keyword: string, params?: ProviderQueryParams) {
    return (await callProxy<SerpResultItem[]>('serp_results', { keyword, ...params })) ?? []
  }

  async getTrafficEstimate(domain: string, params?: ProviderQueryParams) {
    return (await callProxy<TrafficEstimatePoint[]>('traffic_estimate', { domain, ...params })) ?? []
  }
}

export const seoProvider = new SeoApiProvider()

export async function checkProviderConfigured(): Promise<boolean> {
  const { data } = await supabase.functions.invoke<ProxyResponse<null>>('seo-provider-proxy', {
    body: { action: 'status', params: {} },
  })
  configuredCache = data?.configured ?? false
  return configuredCache
}
