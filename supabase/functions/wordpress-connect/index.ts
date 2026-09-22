// Supabase Edge Function: wordpress-connect
//
// The per-project WordPress connection, and publishing an approved SEO fix
// through it.
//
// Credential: a WordPress Application Password (Users → Profile →
// Application Passwords in wp-admin) — never the user's real login
// password. It is scoped to the REST API and revocable in one click from
// the user's own site, independent of their real account credentials.
//
// What it writes: the Yoast SEO title and meta description, and nothing
// else. Never the post title or product name — the user approved a search
// snippet, not a rename of a product on a live shop. Every write is
// preceded by an exact permalink match and followed by reading the values
// back, because WordPress accepts writes to protected meta keys and
// silently ignores them unless the site registered them for REST.
//
// Actions: status | connect | disconnect | preview_fix | apply_fix

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

/** Yoast stores the SEO title and meta description in these post meta keys. */
const YOAST_TITLE_KEY = '_yoast_wpseo_title'
const YOAST_DESC_KEY = '_yoast_wpseo_metadesc'

/**
 * Mirrors normalize_url() in the database, so a permalink coming back from
 * WordPress can be compared with the URL the crawler stored.
 */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

interface WpEntity {
  /** Which API writes it: WordPress core, or WooCommerce for products. */
  api: 'wp' | 'wc'
  route: string
  id: number
  link: string
  postTitle: string
  currentSeoTitle: string | null
  currentSeoDescription: string | null
}

function basicAuth(conn: { username: string; app_password: string }): string {
  return `Basic ${btoa(`${conn.username}:${conn.app_password}`)}`
}

/**
 * Finds the post, page or product behind a crawled URL.
 *
 * The crawler only ever stored URLs, and WordPress writes by ID, so the two
 * have to be bridged. The slug narrows it down; the permalink comparison is
 * what makes it safe — two content types can share a slug, and writing SEO
 * fields onto the wrong product of a live shop is exactly the damage this
 * check exists to prevent. Anything that doesn't match exactly is refused
 * rather than guessed at.
 */
async function resolveEntity(
  conn: { site_url: string; username: string; app_password: string },
  pageUrl: string,
): Promise<WpEntity | null> {
  const path = new URL(pageUrl).pathname.replace(/\/+$/, '')
  const slug = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
  if (!slug) return null

  const attempts: { api: 'wp' | 'wc'; route: string; url: string }[] = [
    { api: 'wp', route: 'pages', url: `${conn.site_url}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&context=edit` },
    { api: 'wp', route: 'posts', url: `${conn.site_url}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&context=edit` },
    { api: 'wp', route: 'product', url: `${conn.site_url}/wp-json/wp/v2/product?slug=${encodeURIComponent(slug)}&context=edit` },
    { api: 'wc', route: 'products', url: `${conn.site_url}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}` },
  ]

  for (const attempt of attempts) {
    let res: Response
    try {
      res = await fetch(attempt.url, { headers: { Authorization: basicAuth(conn) } })
    } catch {
      continue
    }
    if (!res.ok) {
      await res.body?.cancel()
      continue
    }
    const rows = (await res.json().catch(() => null)) as Record<string, unknown>[] | null
    if (!Array.isArray(rows)) continue

    for (const row of rows) {
      const link = (row.link ?? row.permalink) as string | undefined
      if (!link || normalizeUrl(link) !== normalizeUrl(pageUrl)) continue

      const meta = (row.meta ?? {}) as Record<string, unknown>
      const metaData = (row.meta_data ?? []) as { key: string; value: unknown }[]
      const fromMetaData = (key: string) => metaData.find((m) => m.key === key)?.value as string | undefined
      const titleField = row.title as { raw?: string; rendered?: string } | undefined

      return {
        api: attempt.api,
        route: attempt.route,
        id: Number(row.id),
        link,
        postTitle: (titleField?.raw ?? titleField?.rendered ?? (row.name as string) ?? '') as string,
        currentSeoTitle: ((meta[YOAST_TITLE_KEY] as string) ?? fromMetaData(YOAST_TITLE_KEY) ?? null) || null,
        currentSeoDescription: ((meta[YOAST_DESC_KEY] as string) ?? fromMetaData(YOAST_DESC_KEY) ?? null) || null,
      }
    }
  }
  return null
}

/**
 * Writes the Yoast SEO title and meta description — and nothing else.
 *
 * Deliberately never touches the post title or product name: what the user
 * approved is a search-result snippet, and renaming a product on a live shop
 * is a different, far larger change they did not ask for. WordPress core
 * treats Yoast's keys as protected meta and ignores writes to them unless the
 * site has registered them for REST, so the write is verified by reading the
 * values back; an unverified write is reported as not applied rather than
 * announced as success.
 */
async function writeSeoFields(
  conn: { site_url: string; username: string; app_password: string },
  entity: WpEntity,
  fields: { title: string | null; description: string | null },
): Promise<{ applied: boolean; title: string | null; description: string | null }> {
  const meta: Record<string, string> = {}
  if (fields.title) meta[YOAST_TITLE_KEY] = fields.title
  if (fields.description) meta[YOAST_DESC_KEY] = fields.description

  const url =
    entity.api === 'wc'
      ? `${conn.site_url}/wp-json/wc/v3/products/${entity.id}`
      : `${conn.site_url}/wp-json/wp/v2/${entity.route}/${entity.id}`
  const body =
    entity.api === 'wc'
      ? { meta_data: Object.entries(meta).map(([key, value]) => ({ key, value })) }
      : { meta }

  const res = await fetch(url, {
    method: entity.api === 'wc' ? 'PUT' : 'POST',
    headers: { Authorization: basicAuth(conn), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('SEO field write failed', res.status, detail)
    throw new WpError(`WordPress ha rifiutato la scrittura (HTTP ${res.status}).`, 'write_rejected')
  }
  await res.body?.cancel()

  // Trust nothing: read the values back and compare.
  const after = await resolveEntity(conn, entity.link)
  const titleOk = !fields.title || after?.currentSeoTitle === fields.title
  const descOk = !fields.description || after?.currentSeoDescription === fields.description
  return {
    applied: Boolean(after) && titleOk && descOk,
    title: after?.currentSeoTitle ?? null,
    description: after?.currentSeoDescription ?? null,
  }
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
    // preview_fix / apply_fix
    page_url?: string
    title?: string | null
    meta_description?: string | null
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

      // Finds what would be written and what it would replace, changing
      // nothing. The user confirms against this before anything is applied:
      // a preview of the actual entity that matched is the difference
      // between an informed click and a blind one on a live shop.
      case 'preview_fix':
      case 'apply_fix': {
        if (!body.page_url) return jsonResponse({ error: 'page_url is required' }, 400)
        if (!body.title && !body.meta_description) {
          return jsonResponse({ error: 'Niente da pubblicare: nessun titolo né meta description.' }, 400)
        }

        const { data: connRaw } = await db
          .from('wordpress_connections')
          .select('site_url, username, app_password, seo_plugin')
          .eq('project_id', projectId)
          .maybeSingle()
        const conn = connRaw as { site_url: string; username: string; app_password: string; seo_plugin: SeoPlugin } | null
        if (!conn) {
          throw new WpError('Connetti prima il tuo sito WordPress a questo progetto.', 'not_connected')
        }
        if (conn.seo_plugin !== 'yoast') {
          throw new WpError(
            'La pubblicazione automatica al momento scrive solo nei campi di Yoast SEO.',
            'unsupported_seo_plugin',
          )
        }

        const entity = await resolveEntity(conn, body.page_url)
        if (!entity) {
          throw new WpError(
            'Non ho trovato con certezza questa pagina su WordPress. Aggiornala a mano per sicurezza.',
            'page_not_found',
          )
        }

        if (action === 'preview_fix') {
          return jsonResponse({
            found: true,
            type: entity.api === 'wc' ? 'prodotto' : entity.route === 'pages' ? 'pagina' : 'articolo',
            id: entity.id,
            link: entity.link,
            post_title: entity.postTitle,
            current_title: entity.currentSeoTitle,
            current_meta_description: entity.currentSeoDescription,
          })
        }

        const result = await writeSeoFields(conn, entity, {
          title: body.title ?? null,
          description: body.meta_description ?? null,
        })
        if (!result.applied) {
          // Yoast's keys are protected meta: WordPress accepts the request and
          // silently ignores them unless the site registered them for REST.
          // Saying "published" here would be a lie the user only discovers
          // weeks later in Search Console.
          throw new WpError(
            'WordPress ha accettato la richiesta ma i campi Yoast non sono cambiati: il sito non espone quei campi alle API. Serve un piccolo snippet una tantum — te lo fornisco io.',
            'yoast_fields_not_writable',
          )
        }
        return jsonResponse({
          applied: true,
          link: entity.link,
          title: result.title,
          meta_description: result.description,
        })
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
