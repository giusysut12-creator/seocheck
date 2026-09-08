// Supabase Edge Function: seo-provider-proxy
//
// Server-side adapter for the pluggable SEODataProvider interface
// (see src/lib/seo/provider.ts). Keeps SEO_API_KEY / SEO_API_URL as
// server-only secrets — the frontend never sees them.
//
// If SEO_API_URL / SEO_API_KEY are not set, every action responds with
// { configured: false } and the UI shows "SEO data provider not connected"
// instead of inventing numbers.
//
// The response-shape mapping below targets a generic REST provider
// (endpoint per action, JSON body, Bearer auth). Adjust `mapXxx()` below to
// match the actual response schema of whichever SEO data vendor you wire up
// (e.g. DataForSEO, SEMrush API, Ahrefs API) — the action routing and the
// "not configured" contract stay the same.

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
const SEO_API_URL = Deno.env.get('SEO_API_URL')
const SEO_API_KEY = Deno.env.get('SEO_API_KEY')

type ProxyAction =
  | 'status'
  | 'domain_overview'
  | 'organic_keywords'
  | 'keyword_data'
  | 'keyword_rankings'
  | 'competitors'
  | 'backlinks'
  | 'serp_results'
  | 'traffic_estimate'

const ENDPOINTS: Record<Exclude<ProxyAction, 'status'>, string> = {
  domain_overview: '/domain/overview',
  organic_keywords: '/domain/organic-keywords',
  keyword_data: '/keyword/data',
  keyword_rankings: '/keyword/rankings',
  competitors: '/domain/competitors',
  backlinks: '/domain/backlinks',
  serp_results: '/serp/results',
  traffic_estimate: '/domain/traffic-estimate',
}

async function callUpstream(action: Exclude<ProxyAction, 'status'>, params: Record<string, unknown>) {
  const url = new URL(ENDPOINTS[action], SEO_API_URL)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SEO_API_KEY}`,
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    throw new Error(`SEO data provider returned ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }
  return res.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)

  const isConfigured = Boolean(SEO_API_URL && SEO_API_KEY)

  let body: { action?: ProxyAction; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const action = body.action
  if (!action) return jsonResponse({ error: 'action is required' }, 400)

  if (action === 'status') return jsonResponse({ configured: isConfigured })
  if (!isConfigured) return jsonResponse({ configured: false })

  try {
    const raw = await callUpstream(action, body.params ?? {})
    const data = mapResponse(action, raw)
    return jsonResponse({ configured: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SEO data provider request failed'
    return jsonResponse({ configured: true, error: message })
  }
})

// deno-lint-ignore no-explicit-any
function mapResponse(action: Exclude<ProxyAction, 'status'>, raw: any) {
  switch (action) {
    case 'domain_overview':
      return {
        domain: raw.domain ?? null,
        domainAuthority: raw.domain_authority ?? null,
        seoScore: raw.seo_score ?? null,
        organicTraffic: raw.organic_traffic ?? null,
        organicKeywords: raw.organic_keywords ?? null,
        trafficValue: raw.traffic_value ?? null,
        backlinks: raw.backlinks ?? null,
        referringDomains: raw.referring_domains ?? null,
      }
    case 'organic_keywords':
      return (raw.keywords ?? raw ?? []).map((k: Record<string, unknown>) => ({
        keyword: k.keyword,
        position: k.position,
        previousPosition: k.previous_position ?? null,
        searchVolume: k.search_volume ?? null,
        difficulty: k.difficulty ?? null,
        cpc: k.cpc ?? null,
        estimatedTraffic: k.estimated_traffic ?? null,
        url: k.url ?? null,
        searchIntent: k.search_intent ?? null,
        isBranded: Boolean(k.is_branded),
      }))
    case 'keyword_data':
      return raw
        ? {
            keyword: raw.keyword,
            searchVolume: raw.search_volume ?? null,
            difficulty: raw.difficulty ?? null,
            cpc: raw.cpc ?? null,
            searchIntent: raw.search_intent ?? null,
          }
        : null
    case 'keyword_rankings':
      return (raw.rankings ?? raw ?? []).map((r: Record<string, unknown>) => ({
        keyword: r.keyword,
        date: r.date,
        position: r.position ?? null,
        url: r.url ?? null,
        serpFeatures: r.serp_features ?? [],
      }))
    case 'competitors':
      return (raw.competitors ?? raw ?? []).map((c: Record<string, unknown>) => ({
        domain: c.domain,
        organicTraffic: c.organic_traffic ?? null,
        organicKeywords: c.organic_keywords ?? null,
        commonKeywords: c.common_keywords ?? null,
        trafficValue: c.traffic_value ?? null,
        visibility: c.visibility ?? null,
      }))
    case 'backlinks':
      return (raw.backlinks ?? raw ?? []).map((b: Record<string, unknown>) => ({
        sourceUrl: b.source_url,
        sourceDomain: b.source_domain,
        targetUrl: b.target_url,
        anchorText: b.anchor_text ?? null,
        sourceDomainAuthority: b.source_domain_authority ?? null,
        linkType: b.link_type ?? 'dofollow',
        firstSeen: b.first_seen ?? null,
        lastSeen: b.last_seen ?? null,
      }))
    case 'serp_results':
      return (raw.results ?? raw ?? []).map((r: Record<string, unknown>) => ({
        position: r.position ?? null,
        resultType: r.result_type ?? 'organic',
        title: r.title ?? null,
        url: r.url ?? null,
        snippet: r.snippet ?? null,
      }))
    case 'traffic_estimate':
      return (raw.points ?? raw ?? []).map((p: Record<string, unknown>) => ({
        date: p.date,
        organicTraffic: p.organic_traffic ?? null,
        organicKeywords: p.organic_keywords ?? null,
        trafficValue: p.traffic_value ?? null,
      }))
    default:
      return raw
  }
}
