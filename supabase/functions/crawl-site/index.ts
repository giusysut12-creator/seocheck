// Supabase Edge Function: crawl-site
//
// Server-side SEO crawler. Given a project, it:
//   1. fetches robots.txt and sitemap.xml
//   2. crawls up to MAX_URLS pages of the domain (same-origin only),
//      respecting robots.txt disallow rules and crawl-delay
//   3. analyzes each page's HTML for on-page/technical SEO signals
//   4. persists pages, audit issues, and a computed SEO score to the DB
//
// Invoke with: POST { project_id: string }, Authorization: Bearer <user JWT>

// --- database access ---------------------------------------------------
//
// The crawler used to reach the database through npm:@supabase/supabase-js.
// On Supabase's edge runtime the cost of that import is charged to whichever
// request loads it: resolving the package and compiling it, plus its auth,
// realtime and storage clients, spent most of the 2-second CPU budget before
// a single page was fetched. The platform's own log said so — "CPU Time
// exceeded", 2.78s of CPU against 30MB of memory — which is why making each
// slice smaller never helped: the cost was in starting up, not in crawling.
//
// Everything the crawler does is a table read or write, and PostgREST exposes
// those over plain HTTP. So it speaks HTTP, and imports nothing.

type Row = Record<string, unknown>

interface Outcome<T> {
  data: T | null
  error: { message: string } | null
}

/** Encodes one PostgREST `in.(…)` operand, which is quoted and escaped. */
function quoteForIn(value: unknown): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * A request under construction. The shape mirrors the handful of calls the
 * crawler makes, so the code reading and writing rows did not have to change.
 */
// deno-lint-ignore no-explicit-any
class Query<T = any> implements PromiseLike<Outcome<T>> {
  private method = 'GET'
  private columns: string | null = null
  private readonly params: string[] = []
  private readonly prefer: string[] = []
  /** Whether the write should hand the rows back; one value, not two. */
  private returning: 'minimal' | 'representation' = 'minimal'
  private payload: unknown = null
  private rows: 'many' | 'one' | 'maybe' = 'many'

  constructor(
    private readonly baseUrl: string,
    private readonly table: string,
    private readonly headers: Record<string, string>,
  ) {}

  select(columns = '*'): this {
    this.columns = columns
    if (this.method !== 'GET') this.returning = 'representation'
    return this
  }

  insert(rows: Row | Row[]): this {
    this.method = 'POST'
    this.payload = rows
    return this
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }): this {
    this.method = 'POST'
    this.payload = rows
    this.prefer.push('resolution=merge-duplicates')
    if (options?.onConflict) this.params.push(`on_conflict=${encodeURIComponent(options.onConflict)}`)
    return this
  }

  update(patch: Row): this {
    this.method = 'PATCH'
    this.payload = patch
    return this
  }

  delete(): this {
    this.method = 'DELETE'
    return this
  }

  eq(column: string, value: unknown): this {
    this.params.push(`${column}=eq.${encodeURIComponent(String(value))}`)
    return this
  }

  gte(column: string, value: unknown): this {
    this.params.push(`${column}=gte.${encodeURIComponent(String(value))}`)
    return this
  }

  in(column: string, values: unknown[]): this {
    this.params.push(`${column}=in.${encodeURIComponent(`(${values.map(quoteForIn).join(',')})`)}`)
    return this
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.params.push(`order=${encodeURIComponent(`${column}.${options?.ascending === false ? 'desc' : 'asc'}`)}`)
    return this
  }

  limit(count: number): this {
    this.params.push(`limit=${count}`)
    return this
  }

  single(): this {
    this.rows = 'one'
    return this
  }

  maybeSingle(): this {
    this.rows = 'maybe'
    return this
  }

  private async run(): Promise<Outcome<T>> {
    const params = [...this.params]
    if (this.columns) params.push(`select=${encodeURIComponent(this.columns)}`)
    const headers: Record<string, string> = { ...this.headers }
    if (this.payload !== null) headers['Content-Type'] = 'application/json'
    const prefer = this.method === 'GET' ? this.prefer : [...this.prefer, `return=${this.returning}`]
    if (prefer.length > 0) headers['Prefer'] = prefer.join(',')

    const res = await fetch(
      `${this.baseUrl}/rest/v1/${this.table}${params.length > 0 ? `?${params.join('&')}` : ''}`,
      {
        method: this.method,
        headers,
        body: this.payload === null ? undefined : JSON.stringify(this.payload),
      },
    )
    // Reading the body to the end also releases the connection, which matters
    // on a worker that serves many of these.
    const text = await res.text()
    if (!res.ok) return { data: null, error: { message: text || `HTTP ${res.status}` } }

    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (this.rows === 'many') return { data: (parsed ?? []) as T, error: null }

    const returned = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed]
    if (returned.length === 0) {
      return this.rows === 'one' ? { data: null, error: { message: 'No rows returned' } } : { data: null, error: null }
    }
    return { data: returned[0] as T, error: null }
  }

  then<R1 = Outcome<T>, R2 = never>(
    onfulfilled?: ((value: Outcome<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected)
  }
}

function restClient(baseUrl: string, headers: Record<string, string>) {
  // deno-lint-ignore no-explicit-any
  return { from: <T = any>(table: string) => new Query<T>(baseUrl, table, headers) }
}

/** Who the caller is, according to the JWT they sent. */
async function fetchUser(baseUrl: string, anonKey: string, authHeader: string): Promise<{ id: string } | null> {
  const res = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
  const text = await res.text()
  if (!res.ok) return null
  try {
    return JSON.parse(text) as { id: string }
  } catch {
    return null
  }
}

// --- inlined from _shared/cors.ts ---
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// --- inlined from _shared/html.ts ---
// Lightweight, dependency-free HTML analysis helpers for the crawler.
// Regex-based rather than a full DOM parser so the function has zero npm
// dependencies and stays fast inside a Deno edge runtime.

export interface ParsedPage {
  title: string | null
  metaDescription: string | null
  h1: string[]
  h2: string[]
  canonical: string | null
  robotsMeta: string | null
  wordCount: number
  /**
   * The start of the page's visible text. Kept because every recommendation
   * about the *content* of a page — deepen it, cover a question it misses —
   * is otherwise written blind: a word count says a product page is thin
   * without saying what it already claims, and an AI asked to improve it
   * from the title alone invents materials, sizes and licences. Bounded,
   * since only the opening matters for judging what a page is about.
   */
  contentExcerpt: string
  internalLinks: string[]
  externalLinks: string[]
  imagesMissingAlt: number
  imagesTotal: number
}

/** How much visible text to keep per page. */
const CONTENT_EXCERPT_CHARS = 1500

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function matchAll(re: RegExp, html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const r = new RegExp(re)
  while ((m = r.exec(html))) {
    out.push(m[1])
    if (m.index === r.lastIndex) r.lastIndex++
  }
  return out
}

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null

  const metaDescMatch =
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i.exec(html)
  const metaDescription = metaDescMatch ? decodeEntities(metaDescMatch[1].trim()) : null

  const h1 = matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, html).map((h) => decodeEntities(stripTags(h)).trim())
  const h2 = matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, html).map((h) => decodeEntities(stripTags(h)).trim())

  const canonicalMatch =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<link[^>]+href=["']([\s\S]*?)["'][^>]+rel=["']canonical["'][^>]*>/i.exec(html)
  const canonical = canonicalMatch ? canonicalMatch[1].trim() : null

  const robotsMatch =
    /<meta[^>]+name=["']robots["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']robots["'][^>]*>/i.exec(html)
  const robotsMeta = robotsMatch ? robotsMatch[1].trim().toLowerCase() : null

  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
  const bodyHtml = bodyMatch ? bodyMatch[1] : html
  const textOnly = stripTags(bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''))
  const visibleText = decodeEntities(textOnly).replace(/\s+/g, ' ').trim()
  const wordCount = visibleText.split(/\s+/).filter(Boolean).length
  const contentExcerpt = visibleText.slice(0, CONTENT_EXCERPT_CHARS)

  const base = safeUrl(pageUrl)
  const hrefs = matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi, html)
  const internalLinks: string[] = []
  const externalLinks: string[] = []
  for (const href of hrefs) {
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    const resolved = base ? safeResolve(base, href) : href
    if (!resolved) continue
    if (base && resolved.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
      internalLinks.push(resolved.toString())
    } else {
      externalLinks.push(resolved.toString())
    }
  }

  const imgTags = matchAll(/<img\s[^>]*>/gi, html)
  const imagesTotal = imgTags.length
  const imagesMissingAlt = imgTags.filter((tag) => !/alt=["'][^"']*["']/i.test(tag) || /alt=["']\s*["']/i.test(tag)).length

  return {
    title,
    metaDescription,
    h1,
    h2,
    canonical,
    robotsMeta,
    wordCount,
    contentExcerpt,
    internalLinks: Array.from(new Set(internalLinks)),
    externalLinks: Array.from(new Set(externalLinks)),
    imagesMissingAlt,
    imagesTotal,
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

export function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function safeResolve(base: URL, href: string): URL | null {
  try {
    return new URL(href, base)
  } catch {
    return null
  }
}

export interface RobotsRules {
  disallow: string[]
  allow: string[]
  crawlDelaySeconds: number | null
  sitemaps: string[]
}

export function parseRobotsTxt(content: string, userAgent = '*'): RobotsRules {
  const lines = content.split(/\r?\n/)
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }
  let applies = false
  let matchedSpecific = false

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'sitemap' && value) {
      rules.sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      const ua = value.toLowerCase()
      if (ua === '*' && !matchedSpecific) applies = true
      else if (ua === userAgent.toLowerCase()) {
        applies = true
        matchedSpecific = true
      } else {
        applies = false
      }
      continue
    }
    if (!applies) continue
    if (key === 'disallow' && value) rules.disallow.push(value)
    if (key === 'allow' && value) rules.allow.push(value)
    if (key === 'crawl-delay' && value) {
      const n = Number(value)
      if (!Number.isNaN(n)) rules.crawlDelaySeconds = n
    }
  }

  return rules
}

export function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  const allowMatch = rules.allow.find((p) => path.startsWith(p))
  const disallowMatch = rules.disallow.find((p) => path.startsWith(p))
  if (!disallowMatch) return true
  if (allowMatch && allowMatch.length >= disallowMatch.length) return true
  return false
}

export function extractSitemapLocs(xml: string, limit = 500): string[] {
  const out: string[] = []
  const re = /<loc>([\s\S]*?)<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && out.length < limit) {
    out.push(decodeEntities(m[1].trim()))
  }
  return out
}

// --- inlined from _shared/audit.ts ---
// Turns raw crawled-page data into prioritized SEO audit issues and a
// 0-100 SEO Health Score, broken down by category.

export interface CrawledPageResult {
  url: string
  statusCode: number | null
  redirectUrl: string | null
  title: string | null
  metaDescription: string | null
  h1: string[]
  h2Count: number
  canonical: string | null
  robotsMeta: string | null
  isHttps: boolean
  wordCount: number
  /**
   * The start of the page's visible text. Absent unless HTML was parsed —
   * a redirect or a 404 has no content, and an empty string would read like
   * "this page is blank" rather than "nothing was read".
   *
   * Stored so the AI can rewrite a thin page from what it actually says. A
   * word count alone tells us a page is thin without telling us what it
   * claims, and an assistant asked to improve it from the title invents
   * materials, sizes and licences.
   */
  contentExcerpt?: string
  internalLinksCount: number
  externalLinksCount: number
  imagesMissingAlt: number
  loadTimeMs: number | null
  isOrphan: boolean
  error: string | null
}

export type IssuePriority = 'critical' | 'high' | 'medium' | 'low'
export type IssueCategory = 'technical' | 'onpage' | 'performance' | 'indexability' | 'content' | 'backlinks'

export interface AuditIssueDraft {
  issue_type: string
  category: IssueCategory
  priority: IssuePriority
  title: string
  description: string
  why_it_matters: string
  how_to_fix: string
  affected_urls: string[]
}

interface RuleDef {
  issue_type: string
  category: IssueCategory
  priority: IssuePriority
  title: string
  description: (count: number) => string
  why_it_matters: string
  how_to_fix: string
  test: (page: CrawledPageResult) => boolean
}

const RULES: RuleDef[] = [
  {
    issue_type: 'missing_title',
    category: 'onpage',
    priority: 'critical',
    title: 'Pagine senza tag title',
    description: (n) => `${n} pagina/e non hanno un tag <title>.`,
    why_it_matters: 'Il tag title è il segnale on-page più forte che i motori di ricerca usano per capire una pagina, ed è ciò che appare come titolo cliccabile nei risultati.',
    how_to_fix: 'Aggiungi un titolo unico e descrittivo (50-60 caratteri) a ogni pagina, includendo la parola chiave principale vicino all\'inizio.',
    test: (p) => !p.title,
  },
  {
    issue_type: 'title_too_long',
    category: 'onpage',
    priority: 'medium',
    title: 'Tag title troppo lungo',
    description: (n) => `${n} pagina/e hanno un titolo superiore a 60 caratteri e potrebbero essere troncate nei risultati di ricerca.`,
    why_it_matters: 'I titoli oltre ~60 caratteri vengono tagliati nella SERP, nascondendo la tua proposta di valore o parola chiave agli utenti.',
    how_to_fix: 'Riduci il titolo a 50-60 caratteri mantenendo la parola chiave principale e il nome del brand.',
    test: (p) => !!p.title && p.title.length > 60,
  },
  {
    issue_type: 'title_too_short',
    category: 'onpage',
    priority: 'low',
    title: 'Tag title troppo corto',
    description: (n) => `${n} pagina/e hanno un titolo inferiore a 30 caratteri.`,
    why_it_matters: 'Titoli molto corti sprecano l\'opportunità di includere parole chiave e contesto rilevanti che migliorano il tasso di clic.',
    how_to_fix: 'Espandi il titolo a 50-60 caratteri con parole chiave descrittive e rilevanti.',
    test: (p) => !!p.title && p.title.length > 0 && p.title.length < 30,
  },
  {
    issue_type: 'missing_meta_description',
    category: 'onpage',
    priority: 'high',
    title: 'Meta description mancante',
    description: (n) => `${n} pagina/e non hanno una meta description.`,
    why_it_matters: 'Senza una meta description, i motori di ricerca generano automaticamente un estratto dal contenuto della pagina, spesso meno convincente e con un tasso di clic più basso.',
    how_to_fix: 'Scrivi una meta description unica di 120-155 caratteri che riassuma la pagina e includa una call to action.',
    test: (p) => !p.metaDescription,
  },
  {
    issue_type: 'meta_description_too_long',
    category: 'onpage',
    priority: 'low',
    title: 'Meta description troppo lunga',
    description: (n) => `${n} pagina/e hanno una meta description superiore a 155 caratteri e potrebbe essere troncata.`,
    why_it_matters: 'Le descrizioni lunghe vengono tagliate con puntini di sospensione nei risultati di ricerca, nascondendo potenzialmente la call to action.',
    how_to_fix: 'Riduci la meta description a 120-155 caratteri.',
    test: (p) => !!p.metaDescription && p.metaDescription.length > 155,
  },
  {
    issue_type: 'missing_h1',
    category: 'onpage',
    priority: 'high',
    title: 'Intestazione H1 mancante',
    description: (n) => `${n} pagina/e non hanno un\'intestazione H1.`,
    why_it_matters: 'L\'H1 comunica sia agli utenti che ai motori di ricerca l\'argomento principale della pagina e rafforza la rilevanza per la parola chiave target.',
    how_to_fix: 'Aggiungi esattamente un H1 per pagina che indichi chiaramente l\'argomento della pagina.',
    test: (p) => p.h1.length === 0,
  },
  {
    issue_type: 'multiple_h1',
    category: 'onpage',
    priority: 'medium',
    title: 'Intestazioni H1 multiple',
    description: (n) => `${n} pagina/e hanno più di un\'intestazione H1.`,
    why_it_matters: 'Più H1 diluiscono il focus tematico e possono confondere i motori di ricerca sull\'argomento principale della pagina.',
    how_to_fix: 'Mantieni un solo H1 che indichi l\'argomento principale e retrocedi le altre intestazioni a H2/H3.',
    test: (p) => p.h1.length > 1,
  },
  {
    issue_type: 'thin_content',
    category: 'content',
    priority: 'medium',
    title: 'Contenuto scarso',
    description: (n) => `${n} pagina/e hanno meno di 300 parole.`,
    why_it_matters: 'Le pagine con pochissimo contenuto spesso faticano a posizionarsi perché offrono un valore e una profondità tematica limitati rispetto ai concorrenti.',
    how_to_fix: 'Espandi il contenuto con informazioni davvero utili, esempi e risposte alle domande correlate degli utenti.',
    test: (p) => p.wordCount > 0 && p.wordCount < 300,
  },
  {
    issue_type: 'missing_canonical',
    category: 'indexability',
    priority: 'medium',
    title: 'Tag canonical mancante',
    description: (n) => `${n} pagina/e non hanno un tag canonical.`,
    why_it_matters: 'Senza un tag canonical, i motori di ricerca devono indovinare quale variante di URL indicizzare, il che può dividere i segnali di ranking tra URL duplicati.',
    how_to_fix: 'Aggiungi un tag <link rel="canonical"> auto-referenziante a ogni pagina indicizzabile.',
    test: (p) => !p.canonical && p.statusCode === 200,
  },
  {
    issue_type: 'noindex',
    category: 'indexability',
    priority: 'high',
    title: 'Pagine impostate su noindex',
    description: (n) => `${n} pagina/e sono escluse dai risultati di ricerca tramite una direttiva noindex.`,
    why_it_matters: 'Una pagina noindex non può mai posizionarsi, quindi tag noindex involontari rimuovono silenziosamente pagine importanti dai risultati di ricerca.',
    how_to_fix: 'Rimuovi la direttiva noindex da qualsiasi pagina che dovrebbe essere trovabile nella ricerca.',
    test: (p) => !!p.robotsMeta && p.robotsMeta.includes('noindex'),
  },
  {
    issue_type: 'not_https',
    category: 'technical',
    priority: 'critical',
    title: 'Pagina non servita tramite HTTPS',
    description: (n) => `${n} pagina/e sono servite tramite HTTP non sicuro.`,
    why_it_matters: 'HTTPS è un segnale di ranking confermato da Google e i browser segnalano le pagine HTTP come "Non sicure", danneggiando fiducia e conversioni.',
    how_to_fix: 'Servi tutte le pagine tramite HTTPS e reindirizza HTTP a HTTPS con un 301.',
    test: (p) => !p.isHttps,
  },
  {
    issue_type: 'broken_page',
    category: 'technical',
    priority: 'critical',
    title: 'Pagine non funzionanti (4xx/5xx)',
    description: (n) => `${n} URL hanno restituito un codice di stato di errore.`,
    why_it_matters: 'Le pagine non funzionanti sprecano il budget di scansione, creano vicoli ciechi per gli utenti e possono perdere l\'equity di eventuali backlink che puntano ad esse.',
    how_to_fix: 'Correggi l\'errore sottostante, ripristina il contenuto, oppure reindirizza con un 301 l\'URL a una pagina funzionante rilevante.',
    test: (p) => (p.statusCode ?? 0) >= 400,
  },
  {
    issue_type: 'redirect_chain',
    category: 'technical',
    priority: 'low',
    title: 'URL reindirizzato',
    description: (n) => `${n} URL reindirizzano invece di restituire direttamente la pagina.`,
    why_it_matters: 'I reindirizzamenti aggiungono latenza e possono diluire l\'equity dei link, specialmente quando più reindirizzamenti sono concatenati.',
    how_to_fix: 'Aggiorna i link interni e le sitemap affinché puntino direttamente all\'URL di destinazione finale.',
    test: (p) => !!p.redirectUrl,
  },
  {
    issue_type: 'images_missing_alt',
    category: 'onpage',
    priority: 'low',
    title: 'Immagini senza testo alternativo',
    description: (n) => `${n} pagina/e contengono immagini senza attributi alt.`,
    why_it_matters: 'Il testo alternativo aiuta i motori di ricerca a capire il contenuto delle immagini per la ricerca immagini, ed è essenziale per l\'accessibilità con screen reader.',
    how_to_fix: 'Aggiungi un testo alternativo descrittivo a ogni immagine significativa; usa alt="" solo per immagini puramente decorative.',
    test: (p) => p.imagesMissingAlt > 0,
  },
  {
    issue_type: 'slow_page',
    category: 'performance',
    priority: 'medium',
    title: 'Pagine a caricamento lento',
    description: (n) => `${n} pagina/e hanno impiegato più di 2,5s per rispondere.`,
    why_it_matters: 'La velocità della pagina è un fattore di ranking e influisce direttamente sul tasso di abbandono: le pagine più lente convertono e si posizionano peggio.',
    how_to_fix: 'Ottimizza il tempo di risposta del server, comprimi le immagini e riduci le risorse che bloccano il rendering.',
    test: (p) => (p.loadTimeMs ?? 0) > 2500,
  },
  {
    issue_type: 'orphan_page',
    category: 'technical',
    priority: 'medium',
    title: 'Pagine orfane',
    description: (n) => `${n} pagina/e sono nella sitemap ma non hanno link interni che puntano ad esse.`,
    why_it_matters: 'Le pagine orfane sono difficili da scoprire per i motori di ricerca e gli utenti tramite la normale navigazione o scansione.',
    how_to_fix: 'Aggiungi link interni alle pagine orfane da pagine rilevanti e ben collegate, come pagine categoria o hub.',
    test: (p) => p.isOrphan,
  },
  {
    issue_type: 'no_internal_links',
    category: 'technical',
    priority: 'low',
    title: 'Pagine senza link interni in uscita',
    description: (n) => `${n} pagina/e non collegano a nessun\'altra pagina del sito.`,
    why_it_matters: 'Le pagine senza uscita bloccano il flusso di equity dei link e rendono più difficile per i motori di ricerca scoprire contenuti correlati.',
    how_to_fix: 'Aggiungi link interni contestuali a pagine correlate, categorie o un menu di navigazione/footer.',
    test: (p) => p.statusCode === 200 && p.internalLinksCount === 0,
  },
]

export function buildAuditIssues(pages: CrawledPageResult[]): AuditIssueDraft[] {
  const issues: AuditIssueDraft[] = []

  for (const rule of RULES) {
    const affected = pages.filter(rule.test)
    if (affected.length === 0) continue
    issues.push({
      issue_type: rule.issue_type,
      category: rule.category,
      priority: rule.priority,
      title: rule.title,
      description: rule.description(affected.length),
      why_it_matters: rule.why_it_matters,
      how_to_fix: rule.how_to_fix,
      affected_urls: affected.map((p) => p.url).slice(0, 200),
    })
  }

  // Duplicate title / meta description detection across the crawled set.
  const byTitle = new Map<string, string[]>()
  const byMeta = new Map<string, string[]>()
  for (const p of pages) {
    if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.url])
    if (p.metaDescription) byMeta.set(p.metaDescription, [...(byMeta.get(p.metaDescription) ?? []), p.url])
  }
  const dupTitleUrls = Array.from(byTitle.values()).filter((urls) => urls.length > 1).flat()
  if (dupTitleUrls.length > 0) {
    issues.push({
      issue_type: 'duplicate_title',
      category: 'content',
      priority: 'high',
      title: 'Duplicate title tags',
      description: `${dupTitleUrls.length} page(s) share a title tag with another page.`,
      why_it_matters: 'Duplicate titles make it hard for search engines to differentiate pages and can cause the wrong page to rank for a query.',
      how_to_fix: 'Write a unique, specific title for each page reflecting its distinct content.',
      affected_urls: dupTitleUrls.slice(0, 200),
    })
  }
  const dupMetaUrls = Array.from(byMeta.values()).filter((urls) => urls.length > 1).flat()
  if (dupMetaUrls.length > 0) {
    issues.push({
      issue_type: 'duplicate_meta_description',
      category: 'content',
      priority: 'medium',
      title: 'Duplicate meta descriptions',
      description: `${dupMetaUrls.length} page(s) share a meta description with another page.`,
      why_it_matters: 'Duplicate descriptions reduce the uniqueness of each result in the SERP and miss a chance to differentiate pages.',
      how_to_fix: 'Write a unique meta description for each page that reflects its specific content.',
      affected_urls: dupMetaUrls.slice(0, 200),
    })
  }

  return issues.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
}

function priorityWeight(p: IssuePriority) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[p]
}

export interface ScoreBreakdown {
  seo_score: number
  technical_score: number
  onpage_score: number
  performance_score: number
  indexability_score: number
  content_score: number
  backlinks_score: number
  critical_count: number
  warning_count: number
  passed_count: number
}

const CATEGORY_KEYS: Record<IssueCategory, keyof ScoreBreakdown> = {
  technical: 'technical_score',
  onpage: 'onpage_score',
  performance: 'performance_score',
  indexability: 'indexability_score',
  content: 'content_score',
  backlinks: 'backlinks_score',
}

const TOTAL_CHECKS_PER_CATEGORY: Record<IssueCategory, number> = {
  technical: 5,
  onpage: 6,
  performance: 1,
  indexability: 2,
  content: 3,
  backlinks: 1,
}

export function computeScore(issues: AuditIssueDraft[], pagesCrawled: number): ScoreBreakdown {
  const penaltyByPriority: Record<IssuePriority, number> = { critical: 25, high: 15, medium: 8, low: 3 }
  const categoryPenalty: Record<IssueCategory, number> = {
    technical: 0,
    onpage: 0,
    performance: 0,
    indexability: 0,
    content: 0,
    backlinks: 0,
  }

  let criticalCount = 0
  let warningCount = 0

  for (const issue of issues) {
    categoryPenalty[issue.category] += penaltyByPriority[issue.priority]
    if (issue.priority === 'critical') criticalCount += issue.affected_urls.length
    else warningCount += issue.affected_urls.length
  }

  // backlinks score is neutral (0-100 midpoint) until a backlink provider is connected.
  const scores: Record<IssueCategory, number> = {
    technical: Math.max(0, 100 - categoryPenalty.technical),
    onpage: Math.max(0, 100 - categoryPenalty.onpage),
    performance: Math.max(0, 100 - categoryPenalty.performance),
    indexability: Math.max(0, 100 - categoryPenalty.indexability),
    content: Math.max(0, 100 - categoryPenalty.content),
    backlinks: 0,
  }

  const weights: Record<IssueCategory, number> = {
    technical: 0.25,
    onpage: 0.25,
    performance: 0.15,
    indexability: 0.2,
    content: 0.15,
    backlinks: 0,
  }

  const seoScore = Math.round(
    Object.entries(weights).reduce((sum, [cat, w]) => sum + scores[cat as IssueCategory] * w, 0),
  )

  const totalPossibleChecks = pagesCrawled * Object.values(TOTAL_CHECKS_PER_CATEGORY).reduce((a, b) => a + b, 0)
  const failedChecks = issues.reduce((sum, i) => sum + i.affected_urls.length, 0)
  const passedCount = Math.max(0, totalPossibleChecks - failedChecks)

  return {
    seo_score: seoScore,
    technical_score: scores.technical,
    onpage_score: scores.onpage,
    performance_score: scores.performance,
    indexability_score: scores.indexability,
    content_score: scores.content,
    backlinks_score: scores.backlinks,
    critical_count: criticalCount,
    warning_count: warningCount,
    passed_count: passedCount,
  }
}

export interface OpportunityDraft {
  category: 'technical' | 'internal_linking' | 'content'
  title: string
  description: string
  potential_impact: 'high' | 'medium' | 'low'
  opportunity_score: number
  recommended_actions: string[]
  page_url: string | null
}

/**
 * Structural opportunities derived purely from crawl data — no SEO data
 * provider required. Keyword/backlink/content-gap opportunities that need
 * search volume or competitor data are generated separately once a
 * provider is connected.
 */
export function buildCrawlerOpportunities(pages: CrawledPageResult[]): OpportunityDraft[] {
  const drafts: OpportunityDraft[] = []

  const orphans = pages.filter((p) => p.isOrphan)
  if (orphans.length > 0) {
    drafts.push({
      category: 'internal_linking',
      title: `Collega ${orphans.length} pagina/e orfana/e`,
      description: 'Queste pagine esistono nella tua sitemap ma non hanno link interni che puntano ad esse, rendendole difficili da scoprire.',
      potential_impact: orphans.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 40 + orphans.length * 5),
      recommended_actions: [
        'Aggiungi link interni contestuali da pagine correlate e ben collegate',
        'Fai riferimento a queste pagine da pagine categoria o hub',
        'Verifica che le pagine appartengano ancora alla sitemap',
      ],
      page_url: null,
    })
  }

  const noOutlinks = pages.filter((p) => p.statusCode === 200 && p.internalLinksCount === 0)
  if (noOutlinks.length > 0) {
    drafts.push({
      category: 'internal_linking',
      title: `Aggiungi link interni in uscita su ${noOutlinks.length} pagina/e`,
      description: 'Queste pagine non collegano a nessun\'altra pagina del sito, il che blocca il flusso di equity dei link nel resto del sito.',
      potential_impact: 'medium',
      opportunity_score: Math.min(100, 30 + noOutlinks.length * 4),
      recommended_actions: ['Aggiungi link a contenuti correlati, pagine categoria o un menu footer/navigazione'],
      page_url: null,
    })
  }

  const slow = pages.filter((p) => (p.loadTimeMs ?? 0) > 2500)
  if (slow.length > 0) {
    drafts.push({
      category: 'technical',
      title: `Migliora il tempo di caricamento su ${slow.length} pagina/e lente`,
      description: 'Queste pagine hanno impiegato più di 2,5s per rispondere, il che danneggia sia il posizionamento che il tasso di conversione.',
      potential_impact: slow.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 35 + slow.length * 5),
      recommended_actions: ['Ottimizza il tempo di risposta del server', 'Comprimi e carica le immagini in lazy-load', 'Riduci gli script che bloccano il rendering'],
      page_url: null,
    })
  }

  const broken = pages.filter((p) => (p.statusCode ?? 0) >= 400)
  if (broken.length > 0) {
    drafts.push({
      category: 'technical',
      title: `Correggi ${broken.length} pagina/e non funzionante/i`,
      description: 'Questi URL restituiscono un codice di stato di errore, sprecando il budget di scansione e perdendo l\'equity di eventuali link che puntano ad essi.',
      potential_impact: 'high',
      opportunity_score: Math.min(100, 50 + broken.length * 5),
      recommended_actions: ['Ripristina il contenuto o reindirizza con un 301 a una pagina funzionante rilevante', 'Aggiorna i link interni che puntano all\'URL non funzionante'],
      page_url: null,
    })
  }

  const thin = pages.filter((p) => p.wordCount > 0 && p.wordCount < 300)
  if (thin.length > 0) {
    drafts.push({
      category: 'content',
      title: `Espandi ${thin.length} pagina/e con contenuto scarso`,
      description: 'Queste pagine hanno meno di 300 parole, il che di solito indica una profondità tematica limitata rispetto ai concorrenti posizionati.',
      potential_impact: thin.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 30 + thin.length * 4),
      recommended_actions: ['Aggiungi profondità realmente utile: esempi, dati, FAQ', 'Copri sotto-argomenti ed entità correlate', 'Migliora i link interni verso la pagina'],
      page_url: null,
    })
  }

  return drafts
}

export { CATEGORY_KEYS }

const MAX_URLS = 500
const FETCH_TIMEOUT_MS = 8_000
const CONCURRENCY = 4
const DEFAULT_DELAY_MS = 100

/**
 * URLs fetched per invocation. The platform kills a function that outruns its
 * budget, and that ceiling differs by plan and counts CPU separately from
 * wall clock — so rather than guessing it, each call does a slice small
 * enough to finish comfortably and reports whether more remains. The client
 * calls back until the crawl is done.
 */
const CHUNK_SIZE = 8

/** A run older than this is stale; a new request starts a fresh audit. */
const RESUME_WINDOW_MS = 30 * 60 * 1000

/**
 * Wall-clock budget for one slice. Waiting dominates a crawl — a site that
 * declares a Crawl-delay makes the crawler sleep between batches, and honoring
 * a 30-second delay would blow any request budget long before the work does.
 * Rather than ignoring the directive, the slice simply ends and the next call
 * carries on.
 */
const SLICE_BUDGET_MS = 25_000
const USER_AGENT = 'RankPilotBot/1.0 (+https://rankpilot.app/bot)'

/**
 * Cap on how much of a response is read into memory. A page's SEO signals sit
 * in the head and the markup around it; a megabyte covers that with room to
 * spare, and refusing to buffer more keeps one oversized file from costing the
 * whole run.
 */
const MAX_HTML_BYTES = 1_000_000

/**
 * Links that are plainly not pages. Following them wastes a request and, worse,
 * pulls a file of unbounded size into a worker that has a memory budget.
 */
/**
 * Query parameters a WooCommerce/WordPress storefront generates for filtering,
 * sorting, searching and cart actions.
 *
 * Each one produces a near-duplicate of a listing page — or no page at all —
 * and a shop emits hundreds of them. Left in the frontier they consume the
 * crawl budget the actual product pages need, which is how a crawl can report
 * hundreds of pages while the products the user asks about were never fetched.
 * Only links are filtered this way: URLs the site declares in its own sitemap
 * are clean paths and stay untouched.
 */
const FACET_QUERY_PARAM =
  /[?&](orderby|filter_[^=&]*|min_price|max_price|add-to-cart|add_to_wishlist|rating_filter|query_type_[^=&]*|product-page|paged|s|replytocom|utm_[^=&]*)=/i

const NON_PAGE_EXTENSION =
  /\.(jpe?g|png|gif|webp|svg|ico|bmp|avif|css|js|mjs|map|json|xml|rss|atom|pdf|zip|rar|7z|gz|tar|mp[34]|m4a|wav|webm|avi|mov|mkv|woff2?|ttf|otf|eot|csv|xlsx?|docx?|pptx?|exe|dmg|apk)(?:$|\?)/i

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

interface FetchResult {
  statusCode: number | null
  redirectUrl: string | null
  html: string | null
  contentType: string | null
  loadTimeMs: number | null
  error: string | null
  /** Where the request ended up, which differs from the input when followed. */
  finalUrl: string | null
}

/**
 * Releases a response whose body we are not going to read.
 *
 * Leaving a body unread is not free: the connection and the buffers behind it
 * stay alive until the runtime collects them. An edge worker serves many
 * requests before it is recycled, so on a site with plenty of redirects and
 * non-HTML links those abandoned bodies pile up until the worker is killed for
 * exceeding its memory budget — which reads, from the outside, as the crawler
 * failing for no reason. Every path out of a fetch now ends the body.
 */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // A body that is already closed or errored needs nothing from us.
  }
}

/**
 * Reads at most `limit` bytes of a body, then drops the rest, so a single
 * oversized URL cannot exhaust the worker's memory.
 */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        size += value.byteLength
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Already finished; nothing left to release.
    }
  }
  const buf = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

async function timedFetch(url: string, options: { follow?: boolean } = {}): Promise<FetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const start = performance.now()
  try {
    const res = await fetch(url, {
      redirect: options.follow ? 'follow' : 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    })
    const loadTimeMs = Math.round(performance.now() - start)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await discard(res)
      return {
        statusCode: res.status,
        redirectUrl: location,
        html: null,
        contentType: null,
        loadTimeMs,
        error: null,
        finalUrl: res.url || url,
      }
    }
    const contentType = res.headers.get('content-type')
    const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml')
    if (!isHtml) {
      await discard(res)
      return { statusCode: res.status, redirectUrl: null, html: null, contentType, loadTimeMs, error: null, finalUrl: res.url || url }
    }
    const html = await readCapped(res, MAX_HTML_BYTES)
    return { statusCode: res.status, redirectUrl: null, html, contentType, loadTimeMs, error: null, finalUrl: res.url || url }
  } catch (err) {
    const loadTimeMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'Request timed out' : err.message) : 'Fetch failed'
    return { statusCode: null, redirectUrl: null, html: null, contentType: null, loadTimeMs, error: message, finalUrl: null }
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveHomepage(domain: string): Promise<{ base: URL; result: FetchResult } | null> {
  for (const scheme of ['https', 'http']) {
    const url = `${scheme}://${domain}/`
    const result = await timedFetch(url, { follow: true })
    if (result.statusCode !== null || result.error === null) {
      const base = safeUrl(result.finalUrl ?? url) ?? safeUrl(url)
      if (base) return { base, result }
    }
  }
  return null
}

async function fetchRobots(base: URL): Promise<RobotsRules> {
  const result = await timedFetch(new URL('/robots.txt', base).toString(), { follow: true })
  if (result.statusCode === 200 && result.html) {
    return parseRobotsTxt(result.html, USER_AGENT)
  }
  return { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }
}

/**
 * Every URL the site itself declares, via robots.txt's Sitemap lines or
 * /sitemap.xml.
 *
 * A WordPress/Yoast sitemap is an index whose children are split by content
 * type — post-sitemap.xml, page-sitemap.xml, product-sitemap1.xml,
 * product-sitemap2.xml, taxonomy sitemaps, and so on. Reading only the first
 * few children silently skips whole content types: on a shop whose index
 * lists posts and pages before products, that means skipping every product,
 * which is precisely the content the crawl exists to analyze. So all of them
 * are read, up to a bound that exists only to stop a pathological index from
 * running away.
 */
const MAX_SITEMAP_INDEXES = 5
const MAX_CHILD_SITEMAPS = 30

async function fetchSitemapUrls(base: URL, robots: RobotsRules): Promise<string[]> {
  const candidates = robots.sitemaps.length > 0 ? robots.sitemaps : [new URL('/sitemap.xml', base).toString()]
  const found: string[] = []
  for (const sitemapUrl of candidates.slice(0, MAX_SITEMAP_INDEXES)) {
    const result = await timedFetch(sitemapUrl, { follow: true })
    if (result.statusCode === 200 && result.html) {
      const locs = extractSitemapLocs(result.html)
      // Sitemap index: recurse one level into child sitemaps.
      const childSitemaps = locs.filter((l) => l.endsWith('.xml'))
      const urlLocs = locs.filter((l) => !l.endsWith('.xml'))
      found.push(...urlLocs)
      for (const child of childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
        const childResult = await timedFetch(child, { follow: true })
        if (childResult.statusCode === 200 && childResult.html) {
          found.push(...extractSitemapLocs(childResult.html))
        }
        if (found.length >= MAX_URLS * 2) break
      }
    }
    if (found.length >= MAX_URLS * 2) break
  }
  return Array.from(new Set(found))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resident memory, in MB.
 *
 * A stopped worker says nothing about why it was stopped: Supabase answers
 * 546 whether the function ran out of memory or out of time. Reporting what
 * each slice used — and what it inherited from the slices before it on the
 * same worker — lets that be read off the failure instead of guessed at.
 */
function memoryMb(): number | null {
  try {
    return Math.round(Deno.memoryUsage().rss / 1_048_576)
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const sliceStartedAt = Date.now()
  const rssStartMb = memoryMb()

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: { action?: string; project_id?: string; max_pages?: number }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  // Reachability ping used by the Settings page to report whether the crawler
  // is actually deployed, rather than assuming it is.
  if (body.action === 'status') return jsonResponse({ configured: true })

  const projectId = body.project_id
  if (!projectId) return jsonResponse({ error: 'project_id is required' }, 400)

  // How much to attempt this call. The caller lowers it after Supabase stops a
  // worker, so the crawl settles on whatever this project's plan actually
  // allows instead of on a number guessed here.
  const requested = Number(body.max_pages)
  const pageBudget = Number.isFinite(requested) ? Math.max(1, Math.min(CHUNK_SIZE, Math.floor(requested))) : CHUNK_SIZE
  const concurrency = Math.min(CONCURRENCY, pageBudget)

  const authHeader = req.headers.get('Authorization') ?? ''
  const user = await fetchUser(SUPABASE_URL, ANON_KEY, authHeader)
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401)

  // Reading the project as the caller, with their JWT, leaves the row-level
  // policies to decide whether they may see it — the service-role key below is
  // only used once that question has been answered.
  const callerClient = restClient(SUPABASE_URL, { apikey: ANON_KEY, Authorization: authHeader })

  const { data: project, error: projectError } = await callerClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (projectError || !project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = restClient(SUPABASE_URL, { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` })

  let { data: domainRow } = await db
    .from('domains')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()
  if (!domainRow) {
    const { data: created } = await db
      .from('domains')
      .insert({ project_id: projectId, domain: project.domain, is_primary: true })
      .select('*')
      .single()
    domainRow = created
  }

  // Continue the run already in flight, so a multi-call crawl accumulates
  // into one audit instead of starting over on every request.
  const { data: inFlight } = await db
    .from('site_audits')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'crawling')
    .gte('started_at', new Date(Date.now() - RESUME_WINDOW_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let audit = inFlight
  if (!audit) {
    const { data: created, error: auditInsertError } = await db
      .from('site_audits')
      .insert({
        project_id: projectId,
        domain_id: domainRow?.id ?? null,
        status: 'crawling',
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single()
    if (auditInsertError || !created) return jsonResponse({ error: 'Could not start audit' }, 500)
    audit = created
  }

  try {
    // Resolving the homepage and reading robots.txt costs two round trips, and
    // the answers cannot change mid-run. A resumed slice reuses what the first
    // one worked out and spends its whole budget on pages instead.
    const saved = (audit.crawl_context ?? null) as { base?: string; robots?: RobotsRules } | null
    const savedBase = saved?.base ? safeUrl(saved.base) : null

    let base: URL
    let robots: RobotsRules
    if (savedBase && saved?.robots) {
      base = savedBase
      robots = saved.robots
    } else {
      const homepage = await resolveHomepage(project.domain)
      if (!homepage || homepage.result.error) {
        const message = homepage?.result.error ?? 'Domain unreachable'
        await db
          .from('site_audits')
          .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
          .eq('id', audit.id)
        return jsonResponse({ error: message, site_audit_id: audit.id }, 200)
      }
      base = homepage.base
      robots = await fetchRobots(base)
      // Best effort: a database that predates the column just re-resolves.
      await db
        .from('site_audits')
        .update({ crawl_context: { base: base.toString(), robots } })
        .eq('id', audit.id)
    }

    // Sitemaps cost up to a dozen round trips; once a run has a frontier
    // there is nothing new to learn from re-reading them every slice.
    const alreadyDiscovered = ((audit.discovered_urls ?? []) as string[]).length > 0
    const sitemapUrls = alreadyDiscovered ? [] : await fetchSitemapUrls(base, robots)

    const queue: string[] = [base.toString()]
    for (const u of sitemapUrls) {
      const resolved = safeUrl(u)
      if (resolved && NON_PAGE_EXTENSION.test(resolved.pathname)) continue
      if (resolved && resolved.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
        queue.push(resolved.toString())
      }
    }

    // Everything known about across the whole run: what earlier slices
    // discovered, plus whatever the sitemap lists now.
    const discovered = new Map<string, string>()
    for (const u of (audit.discovered_urls ?? []) as string[]) discovered.set(normalize(u), u)
    for (const u of queue) discovered.set(normalize(u), u)

    const linkedFrom = new Set<string>((audit.linked_urls ?? []) as string[])

    // Already crawled during this run — the pages table is the record, so a
    // slice never re-fetches what a previous one already handled.
    const { data: crawledRows } = await db
      .from('pages')
      .select('url')
      .eq('project_id', projectId)
      .gte('last_crawled_at', audit.started_at)
    const visited = new Set<string>(((crawledRows ?? []) as { url: string }[]).map((r) => normalize(r.url)))

    const results: CrawledPageResult[] = []
    const toVisit = Array.from(discovered.values()).filter((u) => !visited.has(normalize(u)))

    let cursor = 0
    let urlsErrored = 0
    let crawledThisRun = 0

    const auditId = audit.id
    const domainId = domainRow?.id ?? null

    // What the run knows so far.
    //
    // The frontier is the expensive part of an invocation: up to MAX_URLS * 2
    // URLs of discovered plus as many linked, serialized and sent. Writing it
    // after every batch made each invocation pay that repeatedly, which on a
    // slice that only manages one or two pages is most of what the invocation
    // does — and the platform stops workers that do too much. Pages are
    // committed per batch on their own, so they are safe regardless; losing a
    // slice's frontier only costs rediscovering links, never refetching a
    // page. So it goes out once per slice, and only when it actually changed.
    const frontierSizeAtStart = discovered.size + linkedFrom.size
    const saveFrontier = async () => {
      const frontierChanged = discovered.size + linkedFrom.size !== frontierSizeAtStart
      await db
        .from('site_audits')
        .update({
          urls_crawled: visited.size,
          urls_total: Math.min(discovered.size, MAX_URLS),
          urls_errored: urlsErrored,
          ...(frontierChanged
            ? { discovered_urls: Array.from(discovered.values()), linked_urls: Array.from(linkedFrom) }
            : {}),
        })
        .eq('id', auditId)
    }

    const sliceDeadline = Date.now() + SLICE_BUDGET_MS
    const crawlDelayMs = (robots.crawlDelaySeconds ?? 0) * 1000

    while (cursor < toVisit.length && visited.size < MAX_URLS && crawledThisRun < pageBudget) {
      if (Date.now() > sliceDeadline) break
      const batch = toVisit.slice(cursor, cursor + concurrency).filter((u) => !visited.has(normalize(u)))
      cursor += concurrency
      if (batch.length === 0) continue
      crawledThisRun += batch.length

      const batchResults = await Promise.all(
        batch.map(async (url) => {
          const norm = normalize(url)
          if (visited.has(norm)) return null
          visited.add(norm)

          const path = safeUrl(url)?.pathname ?? '/'
          if (!isAllowedByRobots(path, robots)) {
            return {
              url,
              statusCode: null,
              redirectUrl: null,
              title: null,
              metaDescription: null,
              h1: [],
              h2Count: 0,
              canonical: null,
              robotsMeta: 'disallowed-by-robots',
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: 0,
              internalLinksCount: 0,
              externalLinksCount: 0,
              imagesMissingAlt: 0,
              loadTimeMs: null,
              isOrphan: false,
              error: 'Disallowed by robots.txt',
            } satisfies CrawledPageResult
          }

          const fetched = await timedFetch(url)
          if (fetched.error) urlsErrored++

          if (fetched.redirectUrl) {
            const target = safeUrl(new URL(fetched.redirectUrl, url).toString())
            if (target && target.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
              const targetNorm = normalize(target.toString())
              if (!discovered.has(targetNorm) && discovered.size < MAX_URLS * 2) {
                discovered.set(targetNorm, target.toString())
              }
            }
            return {
              url,
              statusCode: fetched.statusCode,
              redirectUrl: fetched.redirectUrl,
              title: null,
              metaDescription: null,
              h1: [],
              h2Count: 0,
              canonical: null,
              robotsMeta: null,
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: 0,
              internalLinksCount: 0,
              externalLinksCount: 0,
              imagesMissingAlt: 0,
              loadTimeMs: fetched.loadTimeMs,
              isOrphan: false,
              error: null,
            } satisfies CrawledPageResult
          }

          if (fetched.html) {
            const parsed = parseHtml(fetched.html, url)
            for (const link of parsed.internalLinks) {
              const linkNorm = normalize(link)
              if (NON_PAGE_EXTENSION.test(linkNorm)) continue
              if (FACET_QUERY_PARAM.test(linkNorm)) continue
              if (!discovered.has(linkNorm) && discovered.size < MAX_URLS * 2) {
                discovered.set(linkNorm, link)
              }
              // Only pages the run knows about can ever be asked "is this an
              // orphan?", so recording anything else would grow this set with
              // every page crawled — and it is written to the database after
              // every batch and read back at the start of every slice.
              if (discovered.has(linkNorm)) linkedFrom.add(linkNorm)
            }
            return {
              url,
              statusCode: fetched.statusCode,
              redirectUrl: null,
              title: parsed.title,
              metaDescription: parsed.metaDescription,
              h1: parsed.h1,
              h2Count: parsed.h2.length,
              canonical: parsed.canonical,
              robotsMeta: parsed.robotsMeta,
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: parsed.wordCount,
              contentExcerpt: parsed.contentExcerpt,
              internalLinksCount: parsed.internalLinks.length,
              externalLinksCount: parsed.externalLinks.length,
              imagesMissingAlt: parsed.imagesMissingAlt,
              loadTimeMs: fetched.loadTimeMs,
              isOrphan: false,
              error: null,
            } satisfies CrawledPageResult
          }

          return {
            url,
            statusCode: fetched.statusCode,
            redirectUrl: null,
            title: null,
            metaDescription: null,
            h1: [],
            h2Count: 0,
            canonical: null,
            robotsMeta: null,
            isHttps: safeUrl(url)?.protocol === 'https:',
            wordCount: 0,
            internalLinksCount: 0,
            externalLinksCount: 0,
            imagesMissingAlt: 0,
            loadTimeMs: fetched.loadTimeMs,
            isOrphan: false,
            error: fetched.error,
          } satisfies CrawledPageResult
        }),
      )

      const batchRows: CrawledPageResult[] = []
      for (const r of batchResults) {
        if (!r) continue
        batchRows.push(r)
        results.push(r)
      }

      // Commit as each batch lands. A worker that is stopped part-way through
      // a slice used to lose the whole slice; now the pages already fetched
      // are on record and the next call resumes behind them. The frontier
      // does not go out here — see saveFrontier above for why.
      if (batchRows.length > 0) {
        await db
          .from('pages')
          .upsert(batchRows.map((r) => toPageRow(projectId, domainId, r)), { onConflict: 'project_id,url' })
      }

      // Ending the slice beats sleeping past its budget: the next call
      // resumes, and the site still gets the pause it asked for.
      const pause = crawlDelayMs || DEFAULT_DELAY_MS
      if (Date.now() + pause > sliceDeadline) break
      await sleep(pause)
    }

    for (const r of results) visited.add(normalize(r.url))
    await saveFrontier()

    const remaining = Array.from(discovered.keys()).filter((u) => !visited.has(u)).length
    const moreToCrawl = remaining > 0 && visited.size < MAX_URLS
    const totalPlanned = Math.min(discovered.size, MAX_URLS)

    // Scoring the audit reads every page of the run and writes issues,
    // opportunities and metrics — too much to tack onto a slice that has just
    // spent its budget fetching. A slice that crawled anything therefore hands
    // back to the client, and the call after it arrives with nothing left to
    // fetch and the whole budget for finalizing.
    if (moreToCrawl || crawledThisRun > 0) {
      return jsonResponse({
        site_audit_id: auditId,
        status: 'crawling',
        pages_crawled: visited.size,
        urls_pending: remaining,
        urls_total: totalPlanned,
        crawl_delay_seconds: robots.crawlDelaySeconds ?? 0,
        diagnostics: {
          rss_start_mb: rssStartMb,
          rss_end_mb: memoryMb(),
          wall_ms: Date.now() - sliceStartedAt,
          pages_this_slice: crawledThisRun,
          page_budget: pageBudget,
        },
      })
    }

    // ---- Finalization -----------------------------------------------------
    // The audit covers the whole run, not just this slice, so the findings are
    // computed from every page stored for it rather than from what this call
    // happened to fetch.
    const { data: allPages } = await db
      .from('pages')
      .select('*')
      .eq('project_id', projectId)
      .gte('last_crawled_at', audit.started_at)

    const homepageNorm = normalize(base.toString())
    const finalResults: CrawledPageResult[] = ((allPages ?? []) as Record<string, never>[]).map((row) => {
      const p = row as unknown as {
        url: string
        title: string | null
        meta_description: string | null
        h1: string | null
        h1_count: number
        h2_count: number
        canonical: string | null
        robots_meta: string | null
        status_code: number | null
        redirect_url: string | null
        is_https: boolean
        word_count: number | null
        internal_links_count: number
        external_links_count: number
        images_missing_alt_count: number
        load_time_ms: number | null
      }
      return {
        url: p.url,
        statusCode: p.status_code,
        redirectUrl: p.redirect_url,
        title: p.title,
        metaDescription: p.meta_description,
        // Only the count survives storage; the rules care how many there are.
        h1: Array.from({ length: p.h1_count }, (_, i) => (i === 0 ? (p.h1 ?? '') : '')),
        h2Count: p.h2_count,
        canonical: p.canonical,
        robotsMeta: p.robots_meta,
        isHttps: p.is_https,
        wordCount: p.word_count ?? 0,
        internalLinksCount: p.internal_links_count,
        externalLinksCount: p.external_links_count,
        imagesMissingAlt: p.images_missing_alt_count,
        loadTimeMs: p.load_time_ms,
        isOrphan: normalize(p.url) !== homepageNorm && !linkedFrom.has(normalize(p.url)),
        error: null,
      }
    })

    const issues = buildAuditIssues(finalResults)
    const score = computeScore(issues, finalResults.length)

    // Orphan status is only known once the whole run is in, so write it back.
    const orphans = finalResults.filter((r) => r.isOrphan).map((r) => r.url)
    // In batches: these go into the query string, and a run's worth of URLs
    // would overrun what the gateway accepts in one.
    for (let i = 0; i < orphans.length; i += 25) {
      await db
        .from('pages')
        .update({ is_orphan: true })
        .eq('project_id', projectId)
        .in('url', orphans.slice(i, i + 25))
    }

    if (issues.length > 0) {
      await db.from('audit_issues').insert(
        issues.map((issue) => ({
          site_audit_id: audit.id,
          project_id: projectId,
          ...issue,
          affected_count: issue.affected_urls.length,
        })),
      )
    }

    await db
      .from('site_audits')
      .update({
        status: 'completed',
        urls_total: finalResults.length,
        urls_crawled: finalResults.length,
        urls_errored: urlsErrored,
        finished_at: new Date().toISOString(),
        ...score,
      })
      .eq('id', audit.id)

    // Replace previously-generated crawler opportunities for this project so
    // stale structural recommendations don't linger after they're fixed.
    await db
      .from('seo_opportunities')
      .delete()
      .eq('project_id', projectId)
      .in('category', ['technical', 'internal_linking', 'content'])
    const opportunities = buildCrawlerOpportunities(finalResults)
    if (opportunities.length > 0) {
      await db.from('seo_opportunities').insert(
        opportunities.map((o) => ({
          project_id: projectId,
          category: o.category,
          title: o.title,
          description: o.description,
          potential_impact: o.potential_impact,
          opportunity_score: o.opportunity_score,
          recommended_actions: o.recommended_actions,
        })),
      )
    }

    if (domainRow) {
      await db.from('domain_metrics').upsert(
        {
          domain_id: domainRow.id,
          date: new Date().toISOString().slice(0, 10),
          source: 'crawler',
          seo_score: score.seo_score,
        },
        { onConflict: 'domain_id,date,source' },
      )
    }

    return jsonResponse({
      site_audit_id: audit.id,
      status: 'completed',
      pages_crawled: finalResults.length,
      urls_pending: 0,
      ...score,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected crawler error'
    await db
      .from('site_audits')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', audit.id)
    return jsonResponse({ error: message, site_audit_id: audit.id }, 200)
  }
})

/** Shapes one crawl result for the `pages` table. */
function toPageRow(projectId: string, domainId: string | null, r: CrawledPageResult) {
  return {
    project_id: projectId,
    domain_id: domainId,
    url: r.url,
    title: r.title,
    meta_description: r.metaDescription,
    h1: r.h1[0] ?? null,
    h1_count: r.h1.length,
    h2_count: r.h2Count,
    canonical: r.canonical,
    robots_meta: r.robotsMeta,
    status_code: r.statusCode,
    redirect_url: r.redirectUrl,
    is_indexable: !(r.robotsMeta?.includes('noindex') ?? false),
    is_https: r.isHttps,
    word_count: r.wordCount,
    content_excerpt: r.contentExcerpt ?? null,
    internal_links_count: r.internalLinksCount,
    external_links_count: r.externalLinksCount,
    images_missing_alt_count: r.imagesMissingAlt,
    load_time_ms: r.loadTimeMs,
    is_orphan: r.isOrphan,
    last_crawled_at: new Date().toISOString(),
  }
}

function normalize(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    return u.toString()
  } catch {
    return url
  }
}
