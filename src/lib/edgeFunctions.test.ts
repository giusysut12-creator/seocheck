import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'

const invoke = vi.fn()
const auditProgress = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: () => auditProgress() }),
            }),
          }),
        }),
      }),
    }),
  },
}))

const { startCrawl } = await import('./edgeFunctions')

function workerStopped() {
  return { data: null, error: new FunctionsHttpError({ status: 546 }) }
}

function slice(pages: number, pending: number) {
  return {
    data: {
      site_audit_id: 'a1',
      status: pending > 0 ? 'crawling' : 'completed',
      pages_crawled: pages,
      urls_pending: pending,
      urls_total: pages + pending,
    },
    error: null,
  }
}

beforeEach(() => {
  invoke.mockReset()
  auditProgress.mockReset()
  auditProgress.mockResolvedValue({ data: null })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Runs a crawl without waiting out its back-off in real time. */
async function run(onProgress?: (crawled: number) => void) {
  const pending = startCrawl('p1', onProgress ? (p) => onProgress(p.crawled) : undefined)
  await vi.runAllTimersAsync()
  return pending
}

describe('startCrawl', () => {
  it('drives the slices until the crawl reports it is done', async () => {
    invoke.mockResolvedValueOnce(slice(8, 12)).mockResolvedValueOnce(slice(20, 0))

    const seen: number[] = []
    const { data, error } = await run((crawled) => seen.push(crawled))

    expect(error).toBeNull()
    expect(data?.status).toBe('completed')
    expect(seen).toEqual([8, 20])
  })

  it('carries on when a worker is stopped but the pages were saved anyway', async () => {
    // The crawler commits each batch, so a lost response does not mean lost
    // work — the audit row is what says whether the run moved.
    invoke
      .mockResolvedValueOnce(slice(8, 40))
      .mockResolvedValueOnce(workerStopped())
      .mockResolvedValueOnce(slice(24, 0))
    auditProgress.mockResolvedValue({ data: { urls_crawled: 16, urls_total: 48 } })

    const seen: number[] = []
    const { data, error } = await run((crawled) => seen.push(crawled))

    expect(error).toBeNull()
    expect(data?.status).toBe('completed')
    // 16 comes from the database after the stopped slice, not from a response.
    expect(seen).toEqual([8, 16, 24])
  })

  it('gives up once stopped workers stop making progress, keeping what was saved', async () => {
    invoke.mockResolvedValueOnce(slice(17, 83)).mockResolvedValue(workerStopped())
    auditProgress.mockResolvedValue({ data: { urls_crawled: 17, urls_total: 100 } })

    const { data, error } = await run()

    expect(data?.pages_crawled).toBe(17)
    expect(error).toContain('17 pages')
    expect(error).toContain('Rescan again')
  })

  it('asks for less work after each stop, down to one page at a time', async () => {
    // Nobody here knows how much a call may do before the platform stops it,
    // so the crawl has to find out by asking for less until it gets through.
    invoke
      .mockResolvedValueOnce(workerStopped())
      .mockResolvedValueOnce(workerStopped())
      .mockResolvedValueOnce(workerStopped())
      .mockResolvedValueOnce(slice(1, 0))

    await run()

    const asked = invoke.mock.calls.map((c) => (c[1] as { body: { max_pages: number } }).body.max_pages)
    expect(asked).toEqual([8, 4, 2, 1])
  })

  it('says so when even one page at a time is stopped', async () => {
    invoke.mockResolvedValueOnce(slice(17, 83)).mockResolvedValue(workerStopped())
    auditProgress.mockResolvedValue({ data: { urls_crawled: 17, urls_total: 100 } })

    const { error } = await run()

    expect(error).toContain('single page at a time')
  })

  it('reports a missing deployment rather than a crawl failure', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ status: 404 }) })

    const { error } = await run()

    expect(error).toContain('Deploy the "crawl-site" Edge Function')
  })
})
