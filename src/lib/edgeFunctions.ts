import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface CrawlSiteResponse {
  site_audit_id: string
  /** 'crawling' means a slice finished and more URLs are queued. */
  status: 'crawling' | 'completed' | 'failed'
  pages_crawled?: number
  seo_score?: number
  urls_pending?: number
  urls_total?: number
  /** A Crawl-delay the site's robots.txt asks crawlers to respect. */
  crawl_delay_seconds?: number
  /** What the slice cost, so a stopped worker can be diagnosed from outside. */
  diagnostics?: {
    rss_start_mb: number | null
    rss_end_mb: number | null
    wall_ms: number
    pages_this_slice: number
    page_budget?: number
  }
  error?: string
}

export interface CrawlProgress {
  crawled: number
  pending: number
  total: number
  /** Non-zero when the site asks crawlers to pause between requests. */
  crawlDelaySeconds: number
}

/**
 * A crawl runs in slices: the Edge Function fetches a bounded number of URLs
 * and returns, because the platform kills a request that runs too long and a
 * killed request saves nothing. Driving the loop here keeps every caller —
 * and the audit itself — unaware of the chunking.
 *
 * Sized for MAX_URLS (crawl-site/index.ts) at the crawler's normal slice size
 * (PAGES_PER_SLICE below), plus real headroom for slices that only got
 * through fewer pages — a site with a Crawl-delay, or one that just forced a
 * few halvings. A crawl that still hits this cap is not stuck: the frontier
 * and every page found are saved, so pressing Rescan again resumes it rather
 * than starting over.
 */
const MAX_SLICES = 250

/**
 * Supabase answers 546 when it stops a function worker for exceeding its
 * budget. The crawler commits every batch it fetches, so a stopped worker
 * costs at most a handful of pages: calling again resumes behind what was
 * saved. Only a run of them that moves the crawl no further is a real failure.
 */
const MAX_WORKER_STOPS = 4

/**
 * Pages to attempt per call, and the floor it can fall to.
 *
 * How much work a call may do before Supabase stops the worker depends on the
 * project's plan and on how slowly the site answers — neither of which can be
 * known from here. So the crawl asks for less after every stop and a little
 * more after every success, and settles where the platform lets it run.
 */
const PAGES_PER_SLICE = 8
const MIN_PAGES_PER_SLICE = 1

/** A moment between calls, so a retiring worker is not handed the next one. */
const BETWEEN_SLICES_MS = 400

/**
 * Reads how far the run has actually got.
 *
 * A stopped worker loses its response, not its work — the crawler writes each
 * batch as it lands. Asking the database distinguishes a slice that died
 * having done nothing from one that died having saved eight more pages, and
 * only the first is worth giving up over.
 */
async function readCrawlProgress(projectId: string): Promise<{ crawled: number; total: number } | null> {
  const { data } = await supabase
    .from('site_audits')
    .select('urls_crawled, urls_total')
    .eq('project_id', projectId)
    .eq('status', 'crawling')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { crawled: (data.urls_crawled as number) ?? 0, total: (data.urls_total as number) ?? 0 }
}

const NOT_DEPLOYED =
  'Non è stato possibile raggiungere il crawler di controllo del sito. Distribuisci la Edge Function "crawl-site" sul tuo progetto Supabase — le Impostazioni mostrano il suo stato attuale.'

function isWorkerStopped(error: unknown): boolean {
  return error instanceof FunctionsHttpError && error.context?.status === 546
}

/**
 * Turns a raw Edge Function invocation failure into something a user can act
 * on: a missing deployment reads very differently from an error the function
 * itself returned, and the raw SDK message distinguishes neither.
 */
async function describeInvokeError(
  error: unknown,
  progress: CrawlSiteResponse | null,
  pagesPerSlice = PAGES_PER_SLICE,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status
    if (status === 404) return NOT_DEPLOYED
    if (status === 546) {
      const saved = progress?.pages_crawled ?? 0
      const d = progress?.diagnostics
      // The numbers say which budget was overrun — memory climbing across
      // slices reads very differently from a slice that simply ran long — and
      // 546 alone says neither.
      const cost = d
        ? ` (ultima fetta: ${d.pages_this_slice} pagine in ${(d.wall_ms / 1000).toFixed(1)}s, memoria ${d.rss_start_mb ?? '?'}→${d.rss_end_mb ?? '?'} MB)`
        : ''
      // Down to one page per call and still stopped means the cost is in what
      // every call does before it fetches anything, not in the crawling — a
      // different problem, and worth saying so rather than suggesting patience.
      const floor =
        pagesPerSlice <= MIN_PAGES_PER_SLICE
          ? ' È stato fermato anche chiedendo una sola pagina alla volta, quindi il limite viene raggiunto prima che avvenga qualsiasi scansione.'
          : ''
      // Saying what survived matters: the crawl is resumable, so this is a
      // pause to pick back up rather than work to redo.
      return saved > 0
        ? `Supabase ha fermato il crawler dopo ${saved} pagine. Quelle pagine sono salvate — premi Rianalizza per continuare da lì.${floor}${cost}`
        : `Supabase ha fermato il crawler prima che potesse scaricare qualcosa.${floor} Premi Rianalizza; se continua a succedere, il sito potrebbe essere troppo lento a rispondere.${cost}`
    }
    const body = await error.context?.json?.().catch(() => null)
    if (body?.error) return body.error as string
    return `Il crawler ha restituito un errore (HTTP ${status ?? 'unknown'}).`
  }
  return NOT_DEPLOYED
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function startCrawl(
  projectId: string,
  onProgress?: (progress: CrawlProgress) => void,
): Promise<{ data: CrawlSiteResponse | null; error: string | null }> {
  let last: CrawlSiteResponse | null = null
  let workerStops = 0
  let crawledSoFar = 0
  let pagesPerSlice = PAGES_PER_SLICE
  // How often the platform stopped a worker across the whole run. One or two
  // is noise; most of the calls means the cost is in what every invocation
  // does before it fetches anything, and no slice size will fix that.
  let totalWorkerStops = 0

  const report = () => {
    if (!last) return
    onProgress?.({
      crawled: last.pages_crawled ?? 0,
      pending: last.urls_pending ?? 0,
      total: last.urls_total ?? last.pages_crawled ?? 0,
      crawlDelaySeconds: last.crawl_delay_seconds ?? 0,
    })
  }

  for (let slice = 0; slice < MAX_SLICES; slice++) {
    const { data, error } = await supabase.functions.invoke<CrawlSiteResponse>('crawl-site', {
      body: { project_id: projectId, max_pages: pagesPerSlice },
    })

    if (error) {
      if (isWorkerStopped(error)) {
        totalWorkerStops++
        // Ask for less next time. Halving converges in a few steps, and one
        // page per call is the floor — if even that is stopped, the cost is
        // not in the crawling and no slice size will help.
        pagesPerSlice = Math.max(MIN_PAGES_PER_SLICE, Math.floor(pagesPerSlice / 2))

        // The response is gone, but the pages the slice committed are not.
        const saved = await readCrawlProgress(projectId)
        if (saved && saved.crawled > crawledSoFar) {
          crawledSoFar = saved.crawled
          last = {
            ...(last ?? { site_audit_id: '', status: 'crawling' }),
            status: 'crawling',
            pages_crawled: saved.crawled,
            urls_total: saved.total,
            urls_pending: Math.max(saved.total - saved.crawled, 0),
          }
          report()
          // The run is still advancing, so a lost response is a hiccup, not a
          // reason to stop asking.
          workerStops = 0
          await wait(750)
          continue
        }
        if (workerStops < MAX_WORKER_STOPS) {
          workerStops++
          // A fresh worker needs a moment; backing off also keeps a genuinely
          // broken run from hammering the function.
          await wait(1_000 * workerStops)
          continue
        }
      }
      return { data: last, error: await describeInvokeError(error, last, pagesPerSlice) }
    }
    if (data?.error) return { data, error: data.error }

    last = data ?? null
    if (!last) return { data: null, error: 'Il crawler ha restituito una risposta vuota.' }

    // A slice that came back is proof the run is moving again.
    workerStops = 0
    crawledSoFar = Math.max(crawledSoFar, last.pages_crawled ?? 0)
    // Creep back up, so one bad slice does not leave the crawl crawling.
    pagesPerSlice = Math.min(PAGES_PER_SLICE, pagesPerSlice + 1)
    report()

    if (last.status !== 'crawling') return { data: last, error: null }
    await wait(BETWEEN_SLICES_MS)
  }

  // A frontier that keeps growing must not spin forever. What was fetched is
  // saved, so this is somewhere to pick up from rather than a failure.
  //
  // Running out of slices having crawled far fewer pages than slices spent
  // means the platform was stopping workers rather than the site being slow,
  // and that distinction is invisible from a bare page count — so the numbers
  // behind it are part of the message rather than buried in a log.
  const d = last?.diagnostics
  const cost = d
    ? ` Ultima chiamata: ${d.pages_this_slice} pagine in ${(d.wall_ms / 1000).toFixed(1)}s, memoria ${d.rss_start_mb ?? '?'}→${d.rss_end_mb ?? '?'} MB.`
    : ''
  const stops =
    totalWorkerStops > 0
      ? ` Supabase ha interrotto ${totalWorkerStops} chiamate su ${MAX_SLICES}${
          pagesPerSlice <= MIN_PAGES_PER_SLICE ? ', anche chiedendo una sola pagina alla volta' : ''
        }.`
      : ''
  return {
    data: last,
    error: `Interrotto dopo ${last?.pages_crawled ?? 0} pagine per non proseguire all'infinito — premi Rianalizza per continuare.${stops}${cost}`,
  }
}

export interface AiAssistantResponse {
  configured: boolean
  answer?: string
  error?: string
}

export async function askAiAssistant(
  projectId: string,
  question: string,
): Promise<{ configured: boolean; answer: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<AiAssistantResponse>('ai-assistant', {
    body: { project_id: projectId, question },
  })
  if (error) return { configured: true, answer: null, error: error.message }
  if (!data) return { configured: false, answer: null, error: null }
  if (!data.configured) return { configured: false, answer: null, error: null }
  if (data.error) return { configured: true, answer: null, error: data.error }
  return { configured: true, answer: data.answer ?? null, error: null }
}

/** Whether the AI assistant has a key configured, without asking it anything. */
export async function checkAiConfigured(): Promise<boolean> {
  const { data } = await supabase.functions.invoke<{ configured: boolean }>('ai-assistant', {
    body: { action: 'status' },
  })
  return data?.configured ?? false
}

/** One ready-to-paste section added to a thin page. */
export interface ContentAddition {
  heading: string
  paragraph: string
}

/** A link to add on another real page of the site, pointing at this one. */
export interface InternalLinkSuggestion {
  /** Always a page the crawler actually found — never invented by the AI. */
  fromUrl: string
  anchorText: string
  reason: string
}

/** What the AI did about one item of the opportunity's to-do list. */
export interface FixStep {
  /** The to-do item verbatim, so the user can see the list is fully covered. */
  action: string
  /** 'ai' = text is ready; 'tu' = needs your decision; 'non_applicabile' = already fine. */
  done: 'ai' | 'tu' | 'non_applicabile'
  detail: string
}

export interface SuggestedFix {
  /** Omitted by the AI when a rewrite isn't warranted or safe — never invented. */
  title: string | null
  metaDescription: string | null
  /** Suggested page heading, when the to-do list covers the H1. */
  h1: string | null
  /** Empty when the page's real text wasn't known well enough to extend it. */
  contentAdditions: ContentAddition[]
  internalLinks: InternalLinkSuggestion[]
  /** One entry per to-do item, in the order the opportunity listed them. */
  steps: FixStep[]
  /** What changed and why, or the decision the user still needs to make. */
  notes: string
}

interface SuggestFixResponse {
  configured: boolean
  fix?: {
    title?: string | null
    meta_description?: string | null
    h1?: string | null
    content_additions?: { heading: string; paragraph: string }[]
    internal_links?: { from_url: string; anchor_text: string; reason: string }[]
    steps?: { action: string; done: string; detail: string }[]
    notes?: string
  }
  error?: string
}

/**
 * Asks the AI assistant to work through every item of one SEO Opportunity's
 * to-do list, grounded in that page's real crawled facts and text, and return
 * the resulting title, meta description, H1, content sections and internal
 * links.
 *
 * This call itself never touches the user's site: publishing is a separate,
 * explicitly confirmed step (see src/lib/wordpress.ts), and only covers the
 * two fields that are safe to overwrite automatically.
 */
export async function suggestFix(
  projectId: string,
  opportunity: {
    keyword: string
    kind: string
    headline: string
    actions: string[]
    page: string | null
    /** For 'cannibalization': every competing page, so the fix is a real decision, not a copy of a CTR rewrite. */
    competingPages?: { page: string; impressions: number; clicks: number; position: number | null }[]
  },
): Promise<{ configured: boolean; fix: SuggestedFix | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<SuggestFixResponse>('ai-assistant', {
    body: {
      action: 'suggest_fix',
      project_id: projectId,
      keyword: opportunity.keyword,
      kind: opportunity.kind,
      headline: opportunity.headline,
      actions: opportunity.actions,
      page_url: opportunity.page,
      competing_pages: opportunity.competingPages,
    },
  })
  if (error) return { configured: true, fix: null, error: error.message }
  if (!data) return { configured: false, fix: null, error: null }
  if (!data.configured) return { configured: false, fix: null, error: null }
  if (data.error) return { configured: true, fix: null, error: data.error }
  return {
    configured: true,
    fix: {
      title: data.fix?.title ?? null,
      metaDescription: data.fix?.meta_description ?? null,
      h1: data.fix?.h1 ?? null,
      contentAdditions: data.fix?.content_additions ?? [],
      internalLinks: (data.fix?.internal_links ?? []).map((l) => ({
        fromUrl: l.from_url,
        anchorText: l.anchor_text,
        reason: l.reason,
      })),
      steps: (data.fix?.steps ?? []).map((st) => ({
        action: st.action,
        done: st.done === 'ai' || st.done === 'non_applicabile' ? st.done : ('tu' as const),
        detail: st.detail,
      })),
      notes: data.fix?.notes ?? '',
    },
    error: null,
  }
}
