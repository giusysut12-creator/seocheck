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
 * saved. Only a run of them with no progress in between is a real failure.
 */
const MAX_WORKER_STOPS = 4

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
async function describeInvokeError(error: unknown, progress: CrawlSiteResponse | null): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status
    if (status === 404) return NOT_DEPLOYED
    if (status === 546) {
      const saved = progress?.pages_crawled ?? 0
      // Saying what survived matters: the crawl is resumable, so this is a
      // pause to pick back up rather than work to redo.
      return saved > 0
        ? `Supabase stopped the crawler after ${saved} pages. Those pages are saved — press Rescan again to carry on from there.`
        : 'Supabase stopped the crawler before it could fetch anything. Press Rescan again; if it keeps happening, the site may be too slow to answer.'
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

  for (let slice = 0; slice < MAX_SLICES; slice++) {
    const { data, error } = await supabase.functions.invoke<CrawlSiteResponse>('crawl-site', {
      body: { project_id: projectId },
    })

    if (error) {
      if (isWorkerStopped(error) && workerStops < MAX_WORKER_STOPS) {
        workerStops++
        // A fresh worker needs a moment; backing off also keeps a genuinely
        // broken run from hammering the function.
        await wait(1_000 * workerStops)
        continue
      }
      return { data: last, error: await describeInvokeError(error, last) }
    }
    if (data?.error) return { data, error: data.error }

    last = data ?? null
    if (!last) return { data: null, error: 'The crawler returned an empty response.' }

    // A slice that came back is proof the run is moving again.
    workerStops = 0

    onProgress?.({
      crawled: last.pages_crawled ?? 0,
      pending: last.urls_pending ?? 0,
      total: last.urls_total ?? last.pages_crawled ?? 0,
      crawlDelaySeconds: last.crawl_delay_seconds ?? 0,
    })

    if (last.status !== 'crawling') return { data: last, error: null }
  }

  // The guard exists so a frontier that somehow keeps growing cannot spin
  // forever; the pages gathered so far are already saved.
  return { data: last, error: null }
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
