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

const { startCrawl, checkAiConfigured, suggestFix, humanizeAssistantText } = await import('./edgeFunctions')

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
    expect(error).toContain('17 pagine')
    expect(error).toContain('Rianalizza')
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

    expect(error).toContain('una sola pagina alla volta')
  })

  it('says how often the platform stopped a worker when it runs out of slices', async () => {
    // A page count alone can't tell "the site is slow" from "the platform
    // kept stopping us", and those need opposite fixes.
    invoke.mockResolvedValue(workerStopped())
    // Progress keeps advancing, so the loop never gives up early — it spends
    // every slice and stops on the cap instead.
    let crawled = 0
    auditProgress.mockImplementation(async () => ({ data: { urls_crawled: ++crawled, urls_total: 500 } }))

    const { error } = await run()

    expect(error).toContain('Supabase ha interrotto')
    expect(error).toContain('una sola pagina alla volta')
  })

  it('reports a missing deployment rather than a crawl failure', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ status: 404 }) })

    const { error } = await run()

    expect(error).toContain('Edge Function "crawl-site"')
  })
})

describe('checkAiConfigured', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('reports whether the assistant has a key set, without asking it anything', async () => {
    invoke.mockResolvedValue({ data: { configured: true }, error: null })

    expect(await checkAiConfigured()).toBe(true)
    expect(invoke).toHaveBeenCalledWith('ai-assistant', { body: { action: 'status' } })
  })

  it('defaults to false when the function is unreachable', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ status: 404 }) })

    expect(await checkAiConfigured()).toBe(false)
  })
})

describe('humanizeAssistantText', () => {
  it('drops a field name the model put in brackets rather than renaming it twice', () => {
    // Verbatim from a real card: correct advice, with an internal name
    // attached that means nothing to the shop owner reading it.
    expect(
      humanizeAssistantText("L'estratto del contenuto (current_content_excerpt) è null. Esegui un Site Audit."),
    ).toBe("L'estratto del contenuto non è disponibile. Esegui un Site Audit.")
  })

  it('renames a field the model used as part of the sentence', () => {
    expect(humanizeAssistantText('Il current_title contiene già la keyword.')).toBe(
      'Il il titolo attuale contiene già la keyword.',
    )
  })

  it('leaves ordinary advice untouched', () => {
    const text = 'Ho aggiunto 4 link interni da pagine Sailor Moon per rafforzare la rilevanza.'
    expect(humanizeAssistantText(text)).toBe(text)
  })
})

describe('suggestFix', () => {
  const opportunity = { keyword: 'tavolo da gioco', kind: 'ctr_gap', headline: 'h', actions: ['a'], page: 'https://x/p' }

  beforeEach(() => {
    invoke.mockReset()
  })

  it('returns the grounded fix the AI proposed', async () => {
    invoke.mockResolvedValue({
      data: { configured: true, fix: { title: 'Titolo', meta_description: 'Descrizione', notes: 'Nota' } },
      error: null,
    })

    const result = await suggestFix('p1', opportunity)

    expect(result).toEqual({
      configured: true,
      error: null,
      fix: {
        title: 'Titolo',
        metaDescription: 'Descrizione',
        h1: null,
        contentAdditions: [],
        internalLinks: [],
        steps: [],
        notes: 'Nota',
      },
    })
    expect(invoke).toHaveBeenCalledWith('ai-assistant', {
      body: {
        action: 'suggest_fix',
        project_id: 'p1',
        keyword: 'tavolo da gioco',
        kind: 'ctr_gap',
        headline: 'h',
        actions: ['a'],
        page_url: 'https://x/p',
      },
    })
  })

  it('carries every part of the plan through, not just the snippet fields', async () => {
    // The opportunity's to-do list asks for more than a title rewrite; if the
    // client dropped these, the user would be back to reading advice instead
    // of receiving the work.
    invoke.mockResolvedValue({
      data: {
        configured: true,
        fix: {
          title: 'Titolo',
          h1: 'Zaino Sailor Moon',
          content_additions: [{ heading: 'Dettagli', paragraph: 'Testo reale.' }],
          internal_links: [{ from_url: 'https://x/altra', anchor_text: 'zaino', reason: 'correlato' }],
          steps: [{ action: 'Approfondisci il contenuto', done: 'ai', detail: 'Ho scritto una sezione.' }],
          notes: 'Nota',
        },
      },
      error: null,
    })

    const { fix } = await suggestFix('p1', opportunity)

    expect(fix?.h1).toBe('Zaino Sailor Moon')
    expect(fix?.contentAdditions).toEqual([{ heading: 'Dettagli', paragraph: 'Testo reale.' }])
    expect(fix?.internalLinks).toEqual([{ fromUrl: 'https://x/altra', anchorText: 'zaino', reason: 'correlato' }])
    expect(fix?.steps).toEqual([
      { action: 'Approfondisci il contenuto', done: 'ai', detail: 'Ho scritto una sezione.' },
    ])
  })

  it('treats an unrecognised step status as needing the user, never as done', async () => {
    // Showing a green "done" for something nobody did is the one failure mode
    // here that leaves a real page unfixed while looking fixed.
    invoke.mockResolvedValue({
      data: {
        configured: true,
        fix: { steps: [{ action: 'Aggiungi foto', done: 'partially', detail: 'Serve una tua foto.' }], notes: '' },
      },
      error: null,
    })

    const { fix } = await suggestFix('p1', opportunity)

    expect(fix?.steps[0].done).toBe('tu')
  })

  it('reports not configured rather than an error when no key is set', async () => {
    invoke.mockResolvedValue({ data: { configured: false }, error: null })

    expect(await suggestFix('p1', opportunity)).toEqual({ configured: false, fix: null, error: null })
  })

  it('forwards every competing page for a cannibalization fix, not just the primary one', async () => {
    // Without the full list, the AI has nothing to tell this opportunity
    // apart from a plain single-page rewrite on the same URL.
    invoke.mockResolvedValue({ data: { configured: true, fix: { notes: 'n' } }, error: null })
    const competingPages = [
      { page: 'https://x/a', impressions: 500, clicks: 50, position: 3 },
      { page: 'https://x/b', impressions: 200, clicks: 5, position: 12 },
    ]

    await suggestFix('p1', { ...opportunity, kind: 'cannibalization', competingPages })

    expect(invoke).toHaveBeenCalledWith('ai-assistant', {
      body: expect.objectContaining({ competing_pages: competingPages }),
    })
  })

  it('surfaces a server-side failure without pretending a fix was returned', async () => {
    invoke.mockResolvedValue({ data: { configured: true, error: 'AI provider error: 529' }, error: null })

    expect(await suggestFix('p1', opportunity)).toEqual({
      configured: true,
      fix: null,
      error: 'AI provider error: 529',
    })
  })
})

