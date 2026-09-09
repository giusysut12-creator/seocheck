import { describe, expect, it } from 'vitest'
import {
  computeOpportunityScore,
  impressionWeight,
  isQuickWin,
  potentialClickGain,
  rankingPotential,
  recommendActions,
  type CrawledPageFacts,
} from './opportunityEngine'

describe('rankingPotential', () => {
  it('rates page-one-but-not-top positions highest', () => {
    expect(rankingPotential(5)).toBeGreaterThan(rankingPotential(15))
    expect(rankingPotential(15)).toBeGreaterThan(rankingPotential(35))
    expect(rankingPotential(35)).toBeGreaterThan(rankingPotential(70))
  })

  it('discounts keywords already at the top, where little room is left', () => {
    expect(rankingPotential(2)).toBeLessThan(rankingPotential(8))
  })
})

describe('impressionWeight', () => {
  it('grows with demand but saturates', () => {
    expect(impressionWeight(0)).toBe(0)
    expect(impressionWeight(200)).toBeLessThan(impressionWeight(20_000))
    expect(impressionWeight(1_000_000)).toBeLessThanOrEqual(1)
  })
})

describe('potentialClickGain', () => {
  it('is zero for keywords already at or above the target position', () => {
    expect(potentialClickGain({ keyword: 'k', position: 2, impressions: 5000, clicks: 800, ctr: 0.16 })).toBe(0)
  })

  it('counts the clicks a better position would add', () => {
    const gain = potentialClickGain({ keyword: 'k', position: 12, impressions: 10_000, clicks: 100, ctr: 0.01 })
    expect(gain).toBeGreaterThan(0)
  })

  it('never goes negative when a page already outperforms the model', () => {
    const gain = potentialClickGain({ keyword: 'k', position: 9, impressions: 1000, clicks: 900, ctr: 0.9 })
    expect(gain).toBe(0)
  })
})

describe('computeOpportunityScore', () => {
  it('is deterministic', () => {
    const input = { keyword: 'seo tool', position: 11.4, impressions: 18_400, clicks: 340, ctr: 0.0185 }
    expect(computeOpportunityScore(input)).toEqual(computeOpportunityScore(input))
  })

  it('flags the specified quick-win example as a real opportunity', () => {
    // From the product spec: position 11.4, 18,400 impressions, 340 clicks.
    const result = computeOpportunityScore({
      keyword: 'seo tool',
      position: 11.4,
      impressions: 18_400,
      clicks: 340,
      ctr: 0.0185,
    })
    expect(result.score).toBeGreaterThan(50)
    expect(result.impact).toBe('high')
    expect(result.potentialClicks).toBeGreaterThan(0)
  })

  it('ranks a high-impression page-one keyword above a deep-position one', () => {
    const nearTop = computeOpportunityScore({
      keyword: 'near top',
      position: 6,
      impressions: 20_000,
      clicks: 400,
      ctr: 0.02,
    })
    const deep = computeOpportunityScore({
      keyword: 'deep',
      position: 70,
      impressions: 20_000,
      clicks: 10,
      ctr: 0.0005,
    })
    expect(nearTop.score).toBeGreaterThan(deep.score)
  })

  it('scores zero when there is no position or no demand', () => {
    expect(computeOpportunityScore({ keyword: 'k', position: null, impressions: 100, clicks: 0, ctr: 0 }).score).toBe(0)
    expect(computeOpportunityScore({ keyword: 'k', position: 12, impressions: 0, clicks: 0, ctr: 0 }).score).toBe(0)
  })

  it('stays within 0-100', () => {
    const extreme = computeOpportunityScore({
      keyword: 'huge',
      position: 8,
      impressions: 10_000_000,
      clicks: 1,
      ctr: 0.0000001,
    })
    expect(extreme.score).toBeGreaterThanOrEqual(0)
    expect(extreme.score).toBeLessThanOrEqual(100)
  })
})

describe('isQuickWin', () => {
  it('accepts positions 4-20 with proven demand', () => {
    expect(isQuickWin({ keyword: 'k', position: 11.4, impressions: 18_400, clicks: 340, ctr: 0.018 })).toBe(true)
  })

  it('rejects top-3 positions and negligible demand', () => {
    expect(isQuickWin({ keyword: 'k', position: 2, impressions: 18_400, clicks: 340, ctr: 0.018 })).toBe(false)
    expect(isQuickWin({ keyword: 'k', position: 12, impressions: 10, clicks: 0, ctr: 0 })).toBe(false)
  })
})

describe('recommendActions', () => {
  const input = { keyword: 'seo audit', position: 12, impressions: 14_200, clicks: 200, ctr: 0.014 }

  it('only reports problems the crawler actually recorded', () => {
    const healthy: CrawledPageFacts = {
      title: 'Complete SEO audit guide',
      h1: 'SEO audit, step by step',
      metaDescription: 'How to run an SEO audit.',
      wordCount: 2400,
      internalLinksCount: 22,
      imagesMissingAlt: 0,
    }
    const actions = recommendActions(input, healthy)
    expect(actions.join(' ')).not.toMatch(/title tag|meta description|H1|words|alt text/i)
  })

  it('calls out a title that omits the keyword', () => {
    const page: CrawledPageFacts = {
      title: 'Our services',
      h1: 'Services',
      metaDescription: 'x',
      wordCount: 2000,
      internalLinksCount: 10,
      imagesMissingAlt: 0,
    }
    expect(recommendActions(input, page).some((a) => a.includes('title tag'))).toBe(true)
  })

  it('cites the measured word count when content is thin', () => {
    const page: CrawledPageFacts = {
      title: 'seo audit',
      h1: 'seo audit',
      metaDescription: 'x',
      wordCount: 620,
      internalLinksCount: 10,
      imagesMissingAlt: 0,
    }
    expect(recommendActions(input, page).some((a) => a.includes('620 words'))).toBe(true)
  })

  it('still returns guidance when no crawl data exists for the page', () => {
    expect(recommendActions(input, null).length).toBeGreaterThan(0)
  })
})
