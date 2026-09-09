// Supabase Edge Function: google-search-console
//
// Every authenticated Search Console operation: starting the OAuth flow,
// listing and selecting properties, reporting connection state, running a
// Search Analytics synchronization, and disconnecting.
//
// Secrets (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) and the stored refresh
// token stay server-side; the browser only ever sees derived data.
//
// Actions: status | auth_url | list_properties | select_property | sync | disconnect

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
const GOOGLE_ADS_DEVELOPER_TOKEN = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'

// Search Console finalizes data with a lag; asking for the last two days
// mostly returns empty rows and makes comparisons look like a drop.
const DATA_LAG_DAYS = 3
const MAX_ROWS_PER_REQUEST = 25000
const MAX_ROWS_PER_SYNC = 100000
const DB_CHUNK = 500
const MAX_KEYWORDS_TRACKED = 1000

const RANGE_DAYS: Record<string, number> = {
  '7d': 7,
  '28d': 28,
  '3m': 90,
  '6m': 180,
  '12m': 365,
}

interface ConnectionRow {
  id: string
  user_id: string
  refresh_token: string
  google_email: string | null
}

class GoogleError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Exchanges the stored refresh token for a short-lived access token. A
 * revoked or expired grant is surfaced as a specific reason so the UI can ask
 * the user to reconnect instead of showing a generic failure.
 */
async function getAccessToken(db: ReturnType<typeof createClient>, connection: ConnectionRow): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new GoogleError('Google integration is not configured on the server.', 'not_configured')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('Token refresh failed', res.status, detail)
    if (detail.includes('invalid_grant')) {
      // The user revoked access, or the token aged out. Drop the dead
      // connection so the UI offers a clean reconnect.
      await db.from('search_console_connections').delete().eq('id', connection.id)
      throw new GoogleError('Your Google connection expired. Please connect again.', 'token_expired')
    }
    throw new GoogleError('Could not refresh Google access token.', 'token_refresh_failed')
  }
  const json = await res.json()
  return json.access_token as string
}

/** Google fetch with retry/backoff on quota and transient server errors. */
async function googleFetch(url: string, accessToken: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2 ** attempt * 1000)
    return googleFetch(url, accessToken, init, attempt + 1)
  }
  if (res.status === 429) throw new GoogleError('Google API quota exceeded. Try again later.', 'quota_exceeded')
  return res
}

async function fetchProperties(accessToken: string) {
  const res = await googleFetch('https://searchconsole.googleapis.com/webmasters/v3/sites', accessToken)
  if (!res.ok) {
    console.error('sites.list failed', res.status, await res.text().catch(() => ''))
    throw new GoogleError('Could not read your Search Console properties.', 'properties_unavailable')
  }
  const json = await res.json()
  return (json.siteEntry ?? []) as { siteUrl: string; permissionLevel: string }[]
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: {
    action?: string
    project_id?: string
    property_url?: string
    redirect_to?: string
    range?: string
    dimensions?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const action = body.action
  if (!action) return jsonResponse({ error: 'action is required' }, 400)

  const serverConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)
  const userId = userData.user.id

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: connectionRaw } = await db
    .from('search_console_connections')
    .select('id, user_id, refresh_token, google_email')
    .eq('user_id', userId)
    .maybeSingle()
  const connection = connectionRaw as ConnectionRow | null

  try {
    switch (action) {
      // -----------------------------------------------------------------
      case 'status': {
        let property: Record<string, unknown> | null = null
        let lastSync: Record<string, unknown> | null = null

        if (body.project_id) {
          const { data: project } = await callerClient
            .from('projects')
            .select('id, search_console_property_id')
            .eq('id', body.project_id)
            .maybeSingle()
          if (project?.search_console_property_id) {
            const { data: prop } = await db
              .from('search_console_properties')
              .select('id, property_url, property_type, permission_level')
              .eq('id', project.search_console_property_id)
              .maybeSingle()
            property = prop
          }
          const { data: sync } = await db
            .from('search_console_syncs')
            .select('*')
            .eq('project_id', body.project_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          lastSync = sync
        }

        return jsonResponse({
          server_configured: serverConfigured,
          connected: Boolean(connection),
          google_email: connection?.google_email ?? null,
          ads_configured: Boolean(GOOGLE_ADS_DEVELOPER_TOKEN),
          property,
          last_sync: lastSync,
        })
      }

      // -----------------------------------------------------------------
      case 'auth_url': {
        if (!serverConfigured) {
          return jsonResponse({ error: 'Google integration is not configured on the server.', reason: 'not_configured' })
        }
        const redirectTo = body.redirect_to ?? ''
        try {
          const parsed = new URL(redirectTo)
          if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
            return jsonResponse({ error: 'redirect_to must be an https URL' }, 400)
          }
        } catch {
          return jsonResponse({ error: 'redirect_to must be a valid URL' }, 400)
        }

        const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
        await db.from('oauth_states').insert({
          state,
          user_id: userId,
          provider: 'google',
          redirect_to: redirectTo,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })

        // Least privilege: the Ads scope is only requested when the server is
        // actually set up to call the Ads API.
        const scopes = [GSC_SCOPE]
        if (GOOGLE_ADS_DEVELOPER_TOKEN) scopes.push(ADS_SCOPE)

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID!)
        authUrl.searchParams.set('redirect_uri', `${SUPABASE_URL}/functions/v1/google-oauth-callback`)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', scopes.join(' '))
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')
        authUrl.searchParams.set('include_granted_scopes', 'true')
        authUrl.searchParams.set('state', state)

        return jsonResponse({ auth_url: authUrl.toString() })
      }

      // -----------------------------------------------------------------
      case 'disconnect': {
        if (connection) await db.from('search_console_connections').delete().eq('id', connection.id)
        return jsonResponse({ connected: false })
      }

      // -----------------------------------------------------------------
      case 'list_properties': {
        if (!connection) return jsonResponse({ error: 'Google account not connected.', reason: 'not_connected' })
        const accessToken = await getAccessToken(db, connection)
        const entries = await fetchProperties(accessToken)

        const rows = entries.map((entry) => ({
          connection_id: connection.id,
          property_url: entry.siteUrl,
          property_type: entry.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix',
          permission_level: entry.permissionLevel ?? null,
        }))
        if (rows.length > 0) {
          await db.from('search_console_properties').upsert(rows, { onConflict: 'connection_id,property_url' })
        }

        const { data: stored } = await db
          .from('search_console_properties')
          .select('id, property_url, property_type, permission_level')
          .eq('connection_id', connection.id)
          .order('property_url')

        return jsonResponse({ properties: stored ?? [] })
      }

      // -----------------------------------------------------------------
      case 'select_property': {
        if (!connection) return jsonResponse({ error: 'Google account not connected.', reason: 'not_connected' })
        if (!body.project_id || !body.property_url) {
          return jsonResponse({ error: 'project_id and property_url are required' }, 400)
        }

        const { data: project } = await callerClient
          .from('projects')
          .select('id')
          .eq('id', body.project_id)
          .maybeSingle()
        if (!project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

        // Re-check against Google rather than trusting the stored list: the
        // user's access may have been revoked since it was cached.
        const accessToken = await getAccessToken(db, connection)
        const entries = await fetchProperties(accessToken)
        const match = entries.find((e) => e.siteUrl === body.property_url)
        if (!match) {
          return jsonResponse({
            error: "You don't have access to this Search Console property.",
            reason: 'no_property_access',
          })
        }

        const { data: prop } = await db
          .from('search_console_properties')
          .upsert(
            {
              connection_id: connection.id,
              property_url: match.siteUrl,
              property_type: match.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix',
              permission_level: match.permissionLevel ?? null,
            },
            { onConflict: 'connection_id,property_url' },
          )
          .select('id, property_url, property_type, permission_level')
          .single()

        await db.from('projects').update({ search_console_property_id: prop!.id }).eq('id', body.project_id)

        return jsonResponse({ property: prop })
      }

      // -----------------------------------------------------------------
      case 'sync': {
        if (!connection) return jsonResponse({ error: 'Google account not connected.', reason: 'not_connected' })
        if (!body.project_id) return jsonResponse({ error: 'project_id is required' }, 400)

        const { data: project } = await callerClient
          .from('projects')
          .select('id, search_console_property_id')
          .eq('id', body.project_id)
          .maybeSingle()
        if (!project) return jsonResponse({ error: 'Project not found or access denied' }, 404)
        if (!project.search_console_property_id) {
          return jsonResponse({ error: 'Select a Search Console property first.', reason: 'no_property' })
        }

        const { data: property } = await db
          .from('search_console_properties')
          .select('id, property_url')
          .eq('id', project.search_console_property_id)
          .maybeSingle()
        if (!property) return jsonResponse({ error: 'Selected property no longer exists.', reason: 'no_property' })

        const days = RANGE_DAYS[body.range ?? '28d'] ?? 28
        const end = new Date(Date.now() - DATA_LAG_DAYS * 24 * 60 * 60 * 1000)
        const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
        const dateFrom = isoDate(start)
        const dateTo = isoDate(end)

        // Defaults to date+query+page. Adding country and device multiplies
        // the row count several-fold, so segmentation is opt-in per sync.
        const dimensions = body.dimensions?.length ? body.dimensions : ['date', 'query', 'page']

        const { data: syncRow } = await db
          .from('search_console_syncs')
          .insert({
            project_id: body.project_id,
            status: 'running',
            date_from: dateFrom,
            date_to: dateTo,
            started_at: new Date().toISOString(),
          })
          .select('*')
          .single()

        try {
          const accessToken = await getAccessToken(db, connection)
          const encoded = encodeURIComponent(property.property_url as string)
          const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`

          let startRow = 0
          let imported = 0
          const keywordTotals = new Map<
            string,
            { clicks: number; impressions: number; positionWeighted: number; page: string }
          >()

          while (imported < MAX_ROWS_PER_SYNC) {
            const res = await googleFetch(endpoint, accessToken, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                startDate: dateFrom,
                endDate: dateTo,
                dimensions,
                rowLimit: MAX_ROWS_PER_REQUEST,
                startRow,
                dataState: 'final',
              }),
            })

            if (res.status === 403) {
              throw new GoogleError(
                "You don't have access to this Search Console property.",
                'no_property_access',
              )
            }
            if (!res.ok) {
              console.error('searchAnalytics.query failed', res.status, await res.text().catch(() => ''))
              throw new GoogleError('Search Console rejected the data request.', 'search_analytics_failed')
            }

            const json = await res.json()
            const rows = (json.rows ?? []) as {
              keys: string[]
              clicks: number
              impressions: number
              ctr: number
              position: number
            }[]
            if (rows.length === 0) break

            const dbRows = rows.map((row) => {
              const values: Record<string, string> = {}
              dimensions.forEach((dim, i) => {
                values[dim] = row.keys[i] ?? ''
              })
              return {
                project_id: body.project_id,
                property_id: property.id,
                date: values.date || dateTo,
                query: values.query ?? '',
                page: values.page ?? '',
                country: values.country ?? '',
                device: values.device ?? '',
                clicks: row.clicks ?? 0,
                impressions: row.impressions ?? 0,
                ctr: row.ctr ?? 0,
                position: row.position ?? null,
              }
            })

            for (const part of chunk(dbRows, DB_CHUNK)) {
              const { error: upsertError } = await db
                .from('search_console_queries')
                .upsert(part, { onConflict: 'project_id,date,row_hash' })
              if (upsertError) {
                console.error('Failed to store Search Console rows', upsertError)
                throw new GoogleError('Could not store the imported data.', 'storage_failed')
              }
            }

            // Aggregate for the keyword-level view while the rows are in hand.
            for (const row of dbRows) {
              if (!row.query) continue
              const current = keywordTotals.get(row.query) ?? {
                clicks: 0,
                impressions: 0,
                positionWeighted: 0,
                page: row.page,
              }
              current.clicks += row.clicks
              current.impressions += row.impressions
              current.positionWeighted += (row.position ?? 0) * row.impressions
              if (row.impressions > 0 && !current.page) current.page = row.page
              keywordTotals.set(row.query, current)
            }

            imported += rows.length
            if (rows.length < MAX_ROWS_PER_REQUEST) break
            startRow += rows.length
          }

          // Keep keyword identity in the existing `keywords` table, tagged
          // with its provenance, so the rest of the app keeps working
          // unchanged. Bounded to the highest-impression keywords.
          const topKeywords = Array.from(keywordTotals.entries())
            .sort((a, b) => b[1].impressions - a[1].impressions)
            .slice(0, MAX_KEYWORDS_TRACKED)

          if (topKeywords.length > 0) {
            const { data: projectRow } = await db
              .from('projects')
              .select('country, device')
              .eq('id', body.project_id)
              .single()

            const keywordRows = topKeywords.map(([keyword]) => ({
              project_id: body.project_id,
              keyword,
              country: projectRow?.country ?? 'US',
              device: projectRow?.device ?? 'desktop',
              source: 'google_search_console',
            }))
            for (const part of chunk(keywordRows, DB_CHUNK)) {
              await db.from('keywords').upsert(part, {
                onConflict: 'project_id,keyword,country,device',
                ignoreDuplicates: true,
              })
            }

            // One ranking point per keyword at the window's end date, carrying
            // the impression-weighted average position for the period. This is
            // an average over the range, not an absolute live position.
            const { data: storedKeywords } = await db
              .from('keywords')
              .select('id, keyword')
              .eq('project_id', body.project_id)
              .in('keyword', topKeywords.map(([k]) => k))

            const idByKeyword = new Map((storedKeywords ?? []).map((k) => [k.keyword as string, k.id as string]))
            const rankingRows = topKeywords
              .filter(([keyword]) => idByKeyword.has(keyword))
              .map(([keyword, totals]) => ({
                keyword_id: idByKeyword.get(keyword)!,
                date: dateTo,
                position: totals.impressions > 0 ? Math.round((totals.positionWeighted / totals.impressions) * 10) / 10 : null,
                url: totals.page || null,
                traffic_estimate: totals.clicks,
                source: 'google_search_console',
              }))
            for (const part of chunk(rankingRows, DB_CHUNK)) {
              await db.from('keyword_rankings').upsert(part, { onConflict: 'keyword_id,date' })
            }
          }

          await db
            .from('search_console_syncs')
            .update({
              status: 'completed',
              rows_imported: imported,
              completed_at: new Date().toISOString(),
            })
            .eq('id', syncRow!.id)

          return jsonResponse({
            status: 'completed',
            rows_imported: imported,
            date_from: dateFrom,
            date_to: dateTo,
            keywords: Math.min(keywordTotals.size, MAX_KEYWORDS_TRACKED),
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Synchronization failed'
          const reason = err instanceof GoogleError ? err.reason : 'unexpected'
          await db
            .from('search_console_syncs')
            .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
            .eq('id', syncRow!.id)
          return jsonResponse({ status: 'failed', error: message, reason })
        }
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    if (err instanceof GoogleError) {
      return jsonResponse({ error: err.message, reason: err.reason })
    }
    console.error('google-search-console error', err)
    return jsonResponse({ error: 'Unexpected error talking to Google.', reason: 'unexpected' }, 200)
  }
})
