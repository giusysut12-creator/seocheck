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
  not_connected: 'Connetti prima il tuo account Google.',
  token_expired: 'La connessione Google è scaduta. Connettiti di nuovo.',
  quota_exceeded: 'Quota Google Ads superata. Riprova più tardi.',
  developer_token_error: "Il developer token di Google Ads è stato rifiutato. Verifica che sia approvato per l'accesso API.",
  invalid_customer_id: 'Questo account Google non può accedere al customer ID Google Ads configurato.',
  api_version: 'La versione dell\'API Google Ads configurata non è più accettata. Imposta GOOGLE_ADS_API_VERSION.',
  storage_failed: 'Le metriche sono state scaricate ma non è stato possibile salvarle.',
  unexpected: 'Qualcosa è andato storto durante la comunicazione con Google Ads.',
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
      'Non è stato possibile raggiungere l\'integrazione Google Ads. Distribuisci la Edge Function "google-ads" sul tuo progetto Supabase.',
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
