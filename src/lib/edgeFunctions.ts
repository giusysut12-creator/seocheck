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
 */
const MAX_SLICES = 60

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
  'Could not reach the Site Audit crawler. Deploy the "crawl-site" Edge Function to your Supabase project — Settings shows its current status.'

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
        ? ` (last slice: ${d.pages_this_slice} pages in ${(d.wall_ms / 1000).toFixed(1)}s, memory ${d.rss_start_mb ?? '?'}→${d.rss_end_mb ?? '?'} MB)`
        : ''
      // Down to one page per call and still stopped means the cost is in what
      // every call does before it fetches anything, not in the crawling — a
      // different problem, and worth saying so rather than suggesting patience.
      const floor =
        pagesPerSlice <= MIN_PAGES_PER_SLICE
          ? ' It was stopped even asking for a single page at a time, so the limit is being reached before any crawling happens.'
          : ''
      // Saying what survived matters: the crawl is resumable, so this is a
      // pause to pick back up rather than work to redo.
      return saved > 0
        ? `Supabase stopped the crawler after ${saved} pages. Those pages are saved — press Rescan again to carry on from there.${floor}${cost}`
        : `Supabase stopped the crawler before it could fetch anything.${floor} Press Rescan again; if it keeps happening, the site may be too slow to answer.${cost}`
    }
    const body = await error.context?.json?.().catch(() => null)
    if (body?.error) return body.error as string
    return `The crawler returned an error (HTTP ${status ?? 'unknown'}).`
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
    if (!last) return { data: null, error: 'The crawler returned an empty response.' }

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
  return {
    data: last,
    error: `Paused after ${last?.pages_crawled ?? 0} pages so the run doesn't go on indefinitely — press Rescan to carry on.`,
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
