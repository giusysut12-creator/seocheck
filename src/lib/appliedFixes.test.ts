import { beforeEach, describe, expect, it, vi } from 'vitest'

// The table is the boundary: these tests cover the identity rule and the
// shape of what reaches it, never a real database.
const insert = vi.fn()
const order = vi.fn()
const eq = vi.fn(() => ({ order }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn((_table: string) => ({ select, insert }))
vi.mock('@/lib/supabase', () => ({ supabase: { from } }))

const { appliedFixKey, fetchAppliedFixes, recordAppliedFix, verdictFor } = await import('./appliedFixes')

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null })
  order.mockReset()
})

describe('appliedFixKey', () => {
  it('matches the same page however Search Console spelled its URL', () => {
    // GSC reports https://www.shop.it/p/ where the crawler stored
    // http://shop.it/p — a fix recorded under one must match the other, or
    // the opportunity comes back as if nothing was done.
    const a = appliedFixKey({ keyword: 'zaino', kind: 'ctr_gap', page: 'https://www.shop.it/p/' })
    const b = appliedFixKey({ keyword: 'zaino', kind: 'ctr_gap', page: 'http://shop.it/p' })
    expect(a).toBe(b)
  })

  it('keeps two kinds of problem on the same page apart', () => {
    const ctr = appliedFixKey({ keyword: 'zaino', kind: 'ctr_gap', page: 'https://shop.it/p' })
    const cannibal = appliedFixKey({ keyword: 'zaino', kind: 'cannibalization', page: 'https://shop.it/p' })
    expect(ctr).not.toBe(cannibal)
  })
})

describe('fetchAppliedFixes', () => {
  it('keeps the most recent fix when a page was published more than once', async () => {
    order.mockResolvedValue({
      data: [
        { keyword: 'zaino', kind: 'ctr_gap', page_url: 'https://shop.it/p', applied_at: '2026-02-01T00:00:00.000Z' },
        { keyword: 'zaino', kind: 'ctr_gap', page_url: 'https://shop.it/p', applied_at: '2026-01-01T00:00:00.000Z' },
      ],
      error: null,
    })

    const fixes = await fetchAppliedFixes('p1')

    expect(fixes.size).toBe(1)
    expect([...fixes.values()][0].appliedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('shows the opportunities anyway when the table is not there yet', async () => {
    // A database that predates this migration must not blank the page.
    order.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })

    expect((await fetchAppliedFixes('p1')).size).toBe(0)
  })
})

describe('recordAppliedFix', () => {
  it('records what was published, against the project', async () => {
    await recordAppliedFix('p1', {
      keyword: 'zaino',
      kind: 'ctr_gap',
      page: 'https://shop.it/p',
      title: 'Nuovo titolo',
      metaDescription: 'Nuova descrizione',
    })

    expect(from).toHaveBeenCalledWith('applied_fixes')
    expect(insert).toHaveBeenCalledWith({
      project_id: 'p1',
      keyword: 'zaino',
      kind: 'ctr_gap',
      page_url: 'https://shop.it/p',
      title: 'Nuovo titolo',
      meta_description: 'Nuova descrizione',
    })
  })
})

describe('verdictFor', () => {
  const outcome = (over: Partial<{ beforeDays: number; afterDays: number; beforePos: number | null; afterPos: number | null }>) => ({
    keyword: 'zaino',
    kind: 'ctr_gap',
    pageUrl: 'https://shop.it/p',
    appliedAt: '2026-01-01T00:00:00.000Z',
    before: { clicks: 10, impressions: 500, position: over.beforePos ?? 7, days: over.beforeDays ?? 28 },
    after: { clicks: 40, impressions: 600, position: over.afterPos ?? 4, days: over.afterDays ?? 28 },
  })

  it('refuses a verdict before Google has had time to re-crawl', () => {
    // Four days of data will happily show a "gain" that reverses next week.
    expect(verdictFor(outcome({ afterDays: 4 }))).toBe('too_early')
  })

  it('refuses a verdict with nothing to compare against', () => {
    expect(verdictFor(outcome({ beforeDays: 0 }))).toBe('no_baseline')
  })

  it('reads a real climb as an improvement', () => {
    expect(verdictFor(outcome({ beforePos: 7, afterPos: 4 }))).toBe('improved')
  })

  it('calls a fraction of a position unchanged, not a win', () => {
    // Search Console's average position moves this much on its own.
    expect(verdictFor(outcome({ beforePos: 4.2, afterPos: 3.9 }))).toBe('unchanged')
  })

  it('says so when the page lost ground', () => {
    expect(verdictFor(outcome({ beforePos: 4, afterPos: 9 }))).toBe('worse')
  })
})
