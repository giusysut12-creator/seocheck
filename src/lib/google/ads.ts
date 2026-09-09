import { supabase } from '@/lib/supabase'

/**
 * Client for the google-ads Edge Function.
 *
 * Google Ads metrics describe estimated market demand for a query. Search
 * Console impressions describe how often this particular site was shown. The
 * two are never combined into a single figure.
 */

export interface AdsStatus {
  configured: boolean
  /** Which server-side secrets are still missing, when not configured. */
  missing: string[]
}

const REASON_MESSAGES: Record<string, string> = {
  not_connected: 'Connect your Google account first.',
  token_expired: 'Your Google connection expired. Please connect again.',
  quota_exceeded: 'Google Ads quota exceeded. Please try again later.',
  developer_token_error: 'The Google Ads developer token was rejected. Check that it is approved for API access.',
  invalid_customer_id: 'This Google account cannot access the configured Google Ads customer ID.',
  api_version: 'The configured Google Ads API version is no longer accepted. Set GOOGLE_ADS_API_VERSION.',
  storage_failed: 'The metrics were fetched but could not be saved.',
  unexpected: 'Something went wrong talking to Google Ads.',
}

interface RawResponse {
  configured?: boolean
  error?: string
  reason?: string
  enriched?: number
  requested?: number
  skipped_fresh?: number
  missing?: string[]
}

async function call(action: string, payload: Record<string, unknown> = {}): Promise<RawResponse> {
  const { data, error } = await supabase.functions.invoke<RawResponse>('google-ads', {
    body: { action, ...payload },
  })
  if (error) {
    throw new Error(
      'Could not reach the Google Ads integration. Deploy the "google-ads" Edge Function to your Supabase project.',
    )
  }
  if (data?.error) throw new Error(REASON_MESSAGES[data.reason ?? ''] ?? data.error)
  return data ?? {}
}

export async function getAdsStatus(): Promise<AdsStatus> {
  const raw = await call('status')
  return { configured: Boolean(raw.configured), missing: raw.missing ?? [] }
}

export interface EnrichResult {
  enriched: number
  requested?: number
  skippedFresh?: number
}

/** Fetches volume/CPC for keywords whose cached metrics are missing or stale. */
export async function enrichKeywords(projectId: string, keywords?: string[]): Promise<EnrichResult> {
  const raw = await call('enrich', { project_id: projectId, keywords })
  return { enriched: raw.enriched ?? 0, requested: raw.requested, skippedFresh: raw.skipped_fresh }
}
