import { beforeEach, describe, expect, it, vi } from 'vitest'

// The table is the boundary: these tests cover the identity rule and the
// shape of what reaches it, never a real database.
const insert = vi.fn()
const order = vi.fn()
const eq = vi.fn(() => ({ order }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select, insert }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

const { appliedFixKey, fetchAppliedFixes, recordAppliedFix } = await import('./appliedFixes')

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
