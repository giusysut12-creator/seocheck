import { describe, expect, it } from 'vitest'
import { toRankingRows, type GscPosition } from './rankTracking'

const point = (date: string, position: number | null): GscPosition => ({
  keyword: 'zaino sailor moon',
  date,
  position,
  clicks: 1,
  impressions: 10,
  topPage: 'https://shop.it/p',
})

describe('toRankingRows', () => {
  it('builds history in date order whatever order it arrives in', () => {
    const rows = toRankingRows('k1', [point('2026-03-02', 4), point('2026-03-01', 7)])
    expect(rows.map((r) => r.date)).toEqual(['2026-03-01', '2026-03-02'])
    expect(rows.map((r) => r.position)).toEqual([7, 4])
  })

  it('carries the previous day forward so a change can be shown', () => {
    const rows = toRankingRows('k1', [point('2026-03-01', 7), point('2026-03-02', 4)])
    expect(rows[0].previous_position).toBeNull()
    expect(rows[1].previous_position).toBe(7)
  })

  it('keeps the best position ever reached, not the latest', () => {
    const rows = toRankingRows('k1', [point('2026-03-01', 7), point('2026-03-02', 3), point('2026-03-03', 9)])
    expect(rows.map((r) => r.best_position)).toEqual([7, 3, 3])
  })

  it('rounds to a whole place', () => {
    // 4.3 is an average across a day's searches, not a position anyone saw.
    expect(toRankingRows('k1', [point('2026-03-01', 4.3)])[0].position).toBe(4)
  })

  it('does not let a day without a position become a zero', () => {
    // A day Google reported nothing for is unknown, not "position 0", which
    // would draw a chart line crashing to the top of the page.
    const rows = toRankingRows('k1', [point('2026-03-01', 5), point('2026-03-02', null)])
    expect(rows[1].position).toBeNull()
    expect(rows[1].previous_position).toBe(5)
  })
})
