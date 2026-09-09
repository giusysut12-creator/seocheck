import { describe, expect, it } from 'vitest'
import {
  classifyCannibalization,
  classifyKeyword,
  climbClicks,
  ctrGapClicks,
  rankOpportunities,
  type KeywordSignal,
} from './opportunityTypes'

function signal(overrides: Partial<KeywordSignal> & { keyword: string }): KeywordSignal {
  return { position: 8, impressions: 1000, clicks: 30, ctr: 0.03, ...overrides }
}

describe('classifyKeyword', () => {
  it('ignores keywords with too little data to conclude anything', () => {
    expect(classifyKeyword(signal({ keyword: 'tiny', impressions: 40 }))).toEqual([])
    expect(classifyKeyword(signal({ keyword: 'unranked', position: null }))).toEqual([])
  })

  it('flags a page-one result that is rarely clicked as a snippet problem', () => {
    // Position 5 normally earns about 6%; this earns 1%.
    const found = classifyKeyword(
      signal({ keyword: 'carte da gioco', position: 5, impressions: 900, clicks: 9, ctr: 0.01 }),
    )
    const ctrGap = found.find((o) => o.kind === 'ctr_gap')

    expect(ctrGap).toBeDefined()
    expect(ctrGap!.potentialClicks).toBeGreaterThan(0)
    expect(ctrGap!.actions.join(' ')).toMatch(/title/i)
    // The point of this kind: no ranking work is implied.
    expect(ctrGap!.actions.join(' ')).not.toMatch(/internal link|deepen/i)
  })

  it('does not call a healthy click rate a problem', () => {
    const found = classifyKeyword(signal({ keyword: 'healthy', position: 3, impressions: 1000, clicks: 120, ctr: 0.12 }))
    expect(found.find((o) => o.kind === 'ctr_gap')).toBeUndefined()
  })

  it('flags positions 4-20 as within reach', () => {
    const found = classifyKeyword(signal({ keyword: 'reachable', position: 12, impressions: 5000, clicks: 40, ctr: 0.008 }))
    expect(found.find((o) => o.kind === 'striking_distance')).toBeDefined()
  })

  it('does not treat a top-3 keyword as within reach', () => {
    const found = classifyKeyword(signal({ keyword: 'top', position: 2, impressions: 5000, clicks: 700, ctr: 0.14 }))
    expect(found.find((o) => o.kind === 'striking_distance')).toBeUndefined()
  })

  it('flags a keyword that lost position', () => {
    const found = classifyKeyword(
      signal({ keyword: 'slipping', position: 9, previousPosition: 4, impressions: 2000, clicks: 40, ctr: 0.02 }),
    )
    const losing = found.find((o) => o.kind === 'losing_ground')
    expect(losing).toBeDefined()
    expect(losing!.headline).toMatch(/4\.0.*9\.0/)
  })

  it('flags a sharp click drop even when the position held', () => {
    const found = classifyKeyword(
      signal({ keyword: 'quiet', position: 6, previousPosition: 6, previousClicks: 100, clicks: 40, impressions: 2000, ctr: 0.02 }),
    )
    expect(found.find((o) => o.kind === 'losing_ground')).toBeDefined()
  })

  it('does not report losing ground on a small wobble', () => {
    const found = classifyKeyword(
      signal({ keyword: 'stable', position: 6.4, previousPosition: 6, previousClicks: 100, clicks: 95, impressions: 2000, ctr: 0.05 }),
    )
    expect(found.find((o) => o.kind === 'losing_ground')).toBeUndefined()
  })

  it('can report more than one kind, because both need doing', () => {
    const found = classifyKeyword(
      signal({ keyword: 'both', position: 9, previousPosition: 4, impressions: 4000, clicks: 12, ctr: 0.003 }),
    )
    expect(found.map((o) => o.kind).sort()).toEqual(['ctr_gap', 'losing_ground', 'striking_distance'])
  })
})

describe('ctrGapClicks / climbClicks', () => {
  it('reports nothing to gain when the click rate already beats the model', () => {
    expect(ctrGapClicks(signal({ keyword: 'k', position: 8, impressions: 1000, clicks: 500, ctr: 0.5 }))).toBe(0)
  })

  it('reports nothing to climb when already at the target', () => {
    expect(climbClicks(signal({ keyword: 'k', position: 2, impressions: 1000, clicks: 200, ctr: 0.2 }))).toBe(0)
  })

  it('scales the gap with demand', () => {
    const small = ctrGapClicks(signal({ keyword: 'k', position: 5, impressions: 500, clicks: 2, ctr: 0.004 }))
    const large = ctrGapClicks(signal({ keyword: 'k', position: 5, impressions: 5000, clicks: 20, ctr: 0.004 }))
    expect(large).toBeGreaterThan(small)
  })
})

describe('rankOpportunities', () => {
  it('puts the easier fix first when the traffic at stake is comparable', () => {
    // Same demand and similar recoverable clicks: rewriting a snippet is a
    // single edit, climbing from page two is weeks of work.
    const ranked = rankOpportunities([
      signal({ keyword: 'snippet', position: 5, impressions: 5000, clicks: 25, ctr: 0.005 }),
      signal({ keyword: 'climb', position: 18, impressions: 5000, clicks: 25, ctr: 0.005 }),
    ])
    const first = ranked[0]
    expect(first.kind).toBe('ctr_gap')
  })

  it('drops anything with nothing to gain', () => {
    const ranked = rankOpportunities([signal({ keyword: 'fine', position: 1, impressions: 5000, clicks: 1400, ctr: 0.28 })])
    expect(ranked).toEqual([])
  })

  it('is deterministic', () => {
    const input = [signal({ keyword: 'a', position: 7, impressions: 3000, clicks: 20, ctr: 0.006 })]
    expect(rankOpportunities(input)).toEqual(rankOpportunities(input))
  })
})

describe('classifyCannibalization', () => {
  it('ignores a query served by a single page', () => {
    expect(
      classifyCannibalization({
        keyword: 'solo',
        totalImpressions: 900,
        pages: [{ page: '/a', impressions: 900, clicks: 40, position: 5 }],
      }),
    ).toBeNull()
  })

  it('names the page that should own the query', () => {
    const result = classifyCannibalization({
      keyword: 'giochi da tavolo',
      totalImpressions: 3000,
      pages: [
        { page: '/giochi-da-tavolo', impressions: 2000, clicks: 100, position: 6 },
        { page: '/blog/giochi-da-tavolo-2024', impressions: 1000, clicks: 10, position: 14 },
      ],
    })

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('cannibalization')
    expect(result!.actions[0]).toContain('/giochi-da-tavolo')
    expect(result!.headline).toContain('2')
  })

  it('reports the clicks the weaker pages are failing to convert', () => {
    const result = classifyCannibalization({
      keyword: 'k',
      totalImpressions: 2000,
      pages: [
        { page: '/strong', impressions: 1000, clicks: 100, position: 4 },
        { page: '/weak', impressions: 1000, clicks: 5, position: 20 },
      ],
    })
    // The weak page draws as much demand but converts almost none of it.
    expect(result!.potentialClicks).toBeGreaterThan(50)
  })
})
