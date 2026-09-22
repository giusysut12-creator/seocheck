// Supabase Edge Function: wordpress-connect
//
// Phase 1 of "Applica al sito": storing and verifying a per-project
// WordPress connection. This function never writes anything to the user's
// site — it only checks that the given credentials can authenticate and
// stores them for a later apply step (built separately, once this is
// confirmed working) to use.
//
// Credential: a WordPress Application Password (Users → Profile →
// Application Passwords in wp-admin) — never the user's real login
// password. It is scoped to the REST API and revocable in one click from
// the user's own site, independent of their real account credentials.
//
// Actions: status | connect | disconnect

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

type SeoPlugin = 'yoast' | 'rank_math' | 'aioseo' | 'none'

interface ConnectionRow {
  site_url: string
  username: string
  seo_plugin: SeoPlugin
  connected_at: string
  last_verified_at: string | null
  last_verify_error: string | null
}

class WpError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
  }
}

/** Adds a scheme if missing, requires https (this credential is too sensitive to send in the clear), and drops a trailing slash. */
function normalizeSiteUrl(input: string): string {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new WpError('Il sito deve usare HTTPS — le credenziali non vengono inviate su una connessione non sicura.', 'insecure_url')
  }
  return url.replace(/\/+$/, '')
}

/**
 * Confirms the given Application Password actually authenticates and can
 * edit content, before anything is stored. A wrong URL, a revoked password,
 * or a user without edit rights all fail here rather than surfacing later
 * as a confusing apply-step error.
 */
async function verifyCredentials(siteUrl: string, username: string, appPassword: string): Promise<{ capabilitiesKnown: boolean; canEdit: boolean }> {
  const basic = btoa(`${username}:${appPassword}`)
  let res: Response
  try {
    res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${basic}` },
    })
  } catch {
    throw new WpError('Non è stato possibile raggiungere questo sito. Controlla l\'indirizzo.', 'site_unreachable')
  }
  if (res.status === 401 || res.status === 403) {
    throw new WpError('Nome utente o Password per le applicazioni non validi.', 'invalid_credentials')
  }
  if (res.status === 404) {
    throw new WpError('Questo indirizzo non sembra un sito WordPress (API REST non trovata).', 'not_wordpress')
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('wp/v2/users/me failed', res.status, detail)
    throw new WpError(`Il sito ha risposto con un errore (HTTP ${res.status}).`, 'verify_failed')
  }
  const json = await res.json().catch(() => null)
  const capabilities = json?.capabilities as Record<string, boolean> | undefined
  if (!capabilities) return { capabilitiesKnown: false, canEdit: true }
  const canEdit = Boolean(capabilities.edit_posts || capabilities.edit_pages || capabilities.administrator)
  return { capabilitiesKnown: true, canEdit }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: {
    action?: string
    project_id?: string
    site_url?: string
    username?: string
    app_password?: string
    seo_plugin?: SeoPlugin
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const action = body.action
  if (!action) return jsonResponse({ error: 'action is required' }, 400)

  const projectId = body.project_id
  if (!projectId) return jsonResponse({ error: 'project_id is required' }, 400)

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)

  // RLS on `projects` does the real access check: this fails for a project
  // the caller does not own regardless of what project_id they send.
  const { data: project, error: projectError } = await callerClient.from('projects').select('id').eq('id', projectId).single()
  if (projectError || !project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    switch (action) {
      case 'status': {
        const { data } = await db
          .from('wordpress_connections')
          .select('site_url, username, seo_plugin, connected_at, last_verified_at, last_verify_error')
          .eq('project_id', projectId)
          .maybeSingle()
        const connection = data as ConnectionRow | null
        return jsonResponse({ connected: Boolean(connection), ...(connection ?? {}) })
      }

      case 'connect': {
        if (!body.site_url || !body.username || !body.app_password) {
          return jsonResponse({ error: 'site_url, username and app_password are required' }, 400)
        }
        const siteUrl = normalizeSiteUrl(body.site_url)
        const { capabilitiesKnown, canEdit } = await verifyCredentials(siteUrl, body.username, body.app_password)
        if (capabilitiesKnown && !canEdit) {
          throw new WpError(
            'Queste credenziali funzionano ma questo utente non può modificare pagine o articoli su questo sito.',
            'insufficient_permissions',
          )
        }

        const { error: upsertError } = await db.from('wordpress_connections').upsert(
          {
            project_id: projectId,
            site_url: siteUrl,
            username: body.username,
            app_password: body.app_password,
            seo_plugin: body.seo_plugin ?? 'yoast',
            connected_at: new Date().toISOString(),
            last_verified_at: new Date().toISOString(),
            last_verify_error: null,
          },
          { onConflict: 'project_id' },
        )
        if (upsertError) {
          console.error('wordpress_connections upsert failed', upsertError)
          return jsonResponse({ error: 'Could not save the connection.' }, 500)
        }
        return jsonResponse({ connected: true, site_url: siteUrl, username: body.username })
      }

      case 'disconnect': {
        await db.from('wordpress_connections').delete().eq('project_id', projectId)
        return jsonResponse({ connected: false })
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    if (err instanceof WpError) return jsonResponse({ error: err.message, reason: err.reason }, 200)
    const message = err instanceof Error ? err.message : 'WordPress connection request failed'
    return jsonResponse({ error: message }, 500)
  }
})
