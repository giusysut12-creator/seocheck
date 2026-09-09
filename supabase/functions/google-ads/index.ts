// Supabase Edge Function: google-ads
//
// Enriches keywords with Google Ads Keyword Planner metrics: average monthly
// searches, competition and top-of-page bid. These are a DIFFERENT
// measurement from Search Console impressions — Ads reports estimated market
// demand for a query, Search Console reports how often this specific site was
// actually shown — so they are stored separately (keyword_metrics) and never
// merged into one number.
//
// Google Ads API access needs more than OAuth: a developer token approved by
// Google and a Google Ads customer ID. Without them this function answers
// { configured: false } and the UI says so plainly.
//
// Actions: status | enrich

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const DEVELOPER_TOKEN = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')
const CUSTOMER_ID = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID')
const LOGIN_CUSTOMER_ID = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
// Google retires Ads API versions on a schedule; override when yours lapses.
const API_VERSION = Deno.env.get('GOOGLE_ADS_API_VERSION') || 'v18'

/** Keywords refreshed more recently than this are not re-fetched (or re-billed). */
const CACHE_TTL_DAYS = Number(Deno.env.get('GOOGLE_ADS_CACHE_TTL_DAYS') || '30')
const BATCH_SIZE = 500
const MAX_KEYWORDS = 2000

class AdsError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function digitsOnly(id: string | undefined): string | undefined {
  return id?.replace(/[^0-9]/g, '')
}

async function getAccessToken(db: ReturnType<typeof createClient>, connection: { id: string; refresh_token: string }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('Ads token refresh failed', res.status, detail)
    if (detail.includes('invalid_grant')) {
      await db.from('search_console_connections').delete().eq('id', connection.id)
      throw new AdsError('Your Google connection expired. Please connect again.', 'token_expired')
    }
    throw new AdsError('Could not refresh Google access token.', 'token_refresh_failed')
  }
  return (await res.json()).access_token as string
}

interface AdsMetric {
  keyword: string
  searchVolume: number | null
  cpc: number | null
  competition: string | null
  competitionIndex: number | null
}

/** One batch of keywords through Keyword Planner historical metrics. */
async function fetchMetrics(keywords: string[], accessToken: string, attempt = 0): Promise<AdsMetric[]> {
  const customer = digitsOnly(CUSTOMER_ID)
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customer}:generateKeywordHistoricalMetrics`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEVELOPER_TOKEN!,
  }
  const loginCustomer = digitsOnly(LOGIN_CUSTOMER_ID)
  if (loginCustomer) headers['login-customer-id'] = loginCustomer

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ keywords, keywordPlanNetwork: 'GOOGLE_SEARCH' }),
  })

  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2 ** attempt * 1000)
    return fetchMetrics(keywords, accessToken, attempt + 1)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('Google Ads request failed', res.status, detail)
    if (res.status === 429) throw new AdsError('Google Ads quota exceeded. Try again later.', 'quota_exceeded')
    if (res.status === 401 || res.status === 403) {
      if (detail.includes('DEVELOPER_TOKEN')) {
        throw new AdsError('The Google Ads developer token was rejected.', 'developer_token_error')
      }
      throw new AdsError('This Google account cannot access that Google Ads customer ID.', 'invalid_customer_id')
    }
    if (res.status === 404) {
      throw new AdsError(
        `Google Ads API ${API_VERSION} did not accept the request. The version may have been retired — set GOOGLE_ADS_API_VERSION.`,
        'api_version',
      )
    }
    throw new AdsError('Google Ads rejected the request.', 'ads_request_failed')
  }

  const json = await res.json()
  // Bid values come back in micros (1,000,000 micros = one currency unit).
  return ((json.results ?? []) as Record<string, never>[]).map((row) => {
    const metrics = (row as { keywordMetrics?: Record<string, string> }).keywordMetrics ?? {}
    const highBidMicros = metrics.highTopOfPageBidMicros
    return {
      keyword: (row as { text?: string }).text ?? '',
      searchVolume: metrics.avgMonthlySearches != null ? Number(metrics.avgMonthlySearches) : null,
      cpc: highBidMicros != null ? Number(highBidMicros) / 1_000_000 : null,
      competition: metrics.competition ?? null,
      competitionIndex: metrics.competitionIndex != null ? Number(metrics.competitionIndex) : null,
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: { action?: string; project_id?: string; keywords?: string[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const configured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && DEVELOPER_TOKEN && CUSTOMER_ID)

  if (body.action === 'status') {
    return jsonResponse({
      configured,
      missing: configured
        ? []
        : [
            !GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
            !GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
            !DEVELOPER_TOKEN && 'GOOGLE_ADS_DEVELOPER_TOKEN',
            !CUSTOMER_ID && 'GOOGLE_ADS_CUSTOMER_ID',
          ].filter(Boolean),
    })
  }

  if (!configured) return jsonResponse({ configured: false })

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)

  if (body.action !== 'enrich') return jsonResponse({ error: `Unknown action: ${body.action}` }, 400)
  if (!body.project_id) return jsonResponse({ error: 'project_id is required' }, 400)

  const { data: project } = await callerClient.from('projects').select('id').eq('id', body.project_id).maybeSingle()
  if (!project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: connection } = await db
    .from('search_console_connections')
    .select('id, refresh_token')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!connection) return jsonResponse({ error: 'Google account not connected.', reason: 'not_connected' })

  try {
    // Only keywords that are missing metrics or whose cache has aged out are
    // sent to Google, so repeated runs cost nothing.
    const staleBefore = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    let query = db
      .from('keywords')
      .select('id, keyword, keyword_metrics(source, updated_at)')
      .eq('project_id', body.project_id)
      .limit(MAX_KEYWORDS)
    if (body.keywords?.length) query = query.in('keyword', body.keywords)

    const { data: keywordRows } = await query
    const candidates = ((keywordRows ?? []) as {
      id: string
      keyword: string
      keyword_metrics: { source: string; updated_at: string }[]
    }[]).filter((row) => {
      const existing = row.keyword_metrics?.find((m) => m.source === 'google_ads')
      return !existing || existing.updated_at < staleBefore
    })

    if (candidates.length === 0) {
      return jsonResponse({ configured: true, enriched: 0, skipped_fresh: (keywordRows ?? []).length })
    }

    const accessToken = await getAccessToken(db, connection as { id: string; refresh_token: string })
    const idByKeyword = new Map(candidates.map((c) => [c.keyword, c.id]))

    let enriched = 0
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE).map((c) => c.keyword)
      const metrics = await fetchMetrics(batch, accessToken)

      const rows = metrics
        .filter((m) => idByKeyword.has(m.keyword))
        .map((m) => ({
          keyword_id: idByKeyword.get(m.keyword)!,
          source: 'google_ads',
          search_volume: m.searchVolume,
          cpc: m.cpc,
          competition: m.competition,
          competition_index: m.competitionIndex,
          updated_at: new Date().toISOString(),
        }))

      if (rows.length > 0) {
        const { error: upsertError } = await db
          .from('keyword_metrics')
          .upsert(rows, { onConflict: 'keyword_id,source' })
        if (upsertError) {
          console.error('Failed to store Google Ads metrics', upsertError)
          throw new AdsError('The metrics were fetched but could not be saved.', 'storage_failed')
        }
        enriched += rows.length
      }
    }

    return jsonResponse({ configured: true, enriched, requested: candidates.length })
  } catch (err) {
    if (err instanceof AdsError) return jsonResponse({ configured: true, error: err.message, reason: err.reason })
    console.error('google-ads error', err)
    return jsonResponse({ configured: true, error: 'Unexpected error talking to Google Ads.', reason: 'unexpected' })
  }
})
