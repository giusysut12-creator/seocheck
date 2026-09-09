/**
 * Opportunity classification
 * ==========================
 *
 * A ranked list of keywords is not advice. This module turns each keyword
 * into a specific *kind* of opportunity, because the work each one implies is
 * different: a page that ranks well but is rarely clicked needs a better
 * title, while a page stuck on the second results page needs stronger
 * content. Both look identical in a table sorted by clicks.
 *
 * Everything here is computed from Search Console figures the project has
 * already synchronized. No external keyword provider is involved.
 */

import { impressionWeight, modelledCtr } from '@/lib/seo/opportunityEngine'

export type OpportunityKind = 'ctr_gap' | 'striking_distance' | 'losing_ground' | 'cannibalization'

/** Below this, a period's numbers are too small to draw conclusions from. */
const MIN_IMPRESSIONS = 100

/** A page-one result earning less than this share of its expected clicks. */
const CTR_UNDERPERFORM_RATIO = 0.5

/** Position worsening by at least this much counts as losing ground. */
const POSITION_DROP = 2

/** Clicks falling by at least this share counts as losing ground. */
const CLICK_DROP_RATIO = 0.3

/** The position the engine treats as a realistic improvement target. */
const TARGET_POSITION = 3

export interface KeywordSignal {
  keyword: string
  position: number | null
  impressions: number
  clicks: number
  ctr: number
  previousPosition?: number | null
  previousClicks?: number
  topPage?: string | null
}

export interface ClassifiedOpportunity {
  kind: OpportunityKind
  keyword: string
  /** One line stating what is happening, in the user's terms. */
  headline: string
  /** Monthly clicks realistically recoverable, at today's demand. */
  potentialClicks: number
  /** 0-100, comparable across kinds so a single list can be prioritized. */
  score: number
  actions: string[]
  page: string | null
}

export const KIND_LABELS: Record<OpportunityKind, { label: string; blurb: string }> = {
  ctr_gap: {
    label: 'Rewrite the snippet',
    blurb: 'Ranks well but is rarely clicked — the listing text is the bottleneck, not the position.',
  },
  striking_distance: {
    label: 'Within reach',
    blurb: 'Close enough to the top that a focused push can move it into positions that earn clicks.',
  },
  losing_ground: {
    label: 'Losing ground',
    blurb: 'Slipping compared with the previous period — worth defending before the loss settles in.',
  },
  cannibalization: {
    label: 'Competing with itself',
    blurb: 'Several of your own pages rank for this query, splitting the signals between them.',
  },
}

/**
 * How hard the fix usually is, which decides ordering when two opportunities
 * are worth similar traffic. Rewriting a title is a single edit; climbing
 * from the second results page is weeks of work.
 */
const EFFORT_WEIGHT: Record<OpportunityKind, number> = {
  ctr_gap: 1,
  losing_ground: 0.9,
  cannibalization: 0.85,
  striking_distance: 0.75,
}

function scoreFor(kind: OpportunityKind, potentialClicks: number, impressions: number): number {
  if (potentialClicks <= 0) return 0
  // Saturating so a few very large keywords cannot flatten everything else.
  const gain = potentialClicks / (potentialClicks + 100)
  return Math.max(0, Math.min(100, Math.round(gain * impressionWeight(impressions) * EFFORT_WEIGHT[kind] * 100)))
}

/** Clicks the listing is missing at its current position, from a weak CTR alone. */
export function ctrGapClicks(signal: KeywordSignal): number {
  if (signal.position === null || signal.impressions <= 0) return 0
  const expected = modelledCtr(signal.position)
  if (signal.ctr >= expected) return 0
  return Math.round(signal.impressions * (expected - signal.ctr))
}

/** Clicks the keyword would add by reaching the target position. */
export function climbClicks(signal: KeywordSignal): number {
  if (signal.position === null || signal.impressions <= 0) return 0
  if (signal.position <= TARGET_POSITION) return 0
  return Math.max(0, Math.round(signal.impressions * modelledCtr(TARGET_POSITION) - signal.clicks))
}

/**
 * Every kind a keyword qualifies for. A keyword can legitimately be more than
 * one — sitting on page two *and* falling — and hiding either would hide work
 * that needs doing.
 */
export function classifyKeyword(signal: KeywordSignal): ClassifiedOpportunity[] {
  const found: ClassifiedOpportunity[] = []
  const page = signal.topPage ?? null

  if (signal.position === null || signal.impressions < MIN_IMPRESSIONS) return found

  // Ranks on page one, but the listing is not earning the clicks that
  // position normally does. No ranking work required — the fastest win there is.
  const expectedCtr = modelledCtr(signal.position)
  if (signal.position <= 10 && signal.ctr < expectedCtr * CTR_UNDERPERFORM_RATIO) {
    const potentialClicks = ctrGapClicks(signal)
    if (potentialClicks > 0) {
      found.push({
        kind: 'ctr_gap',
        keyword: signal.keyword,
        headline: `Position ${signal.position.toFixed(1)} but only ${(signal.ctr * 100).toFixed(1)}% click — that position usually earns about ${(expectedCtr * 100).toFixed(0)}%.`,
        potentialClicks,
        score: scoreFor('ctr_gap', potentialClicks, signal.impressions),
        actions: [
          'Rewrite the title tag so it answers this query directly',
          'Write a meta description that gives a reason to choose this result',
          'Check the page still matches what someone searching this wants',
        ],
        page,
      })
    }
  }

  // Close enough to the top that improvement is realistic.
  if (signal.position >= 4 && signal.position <= 20) {
    const potentialClicks = climbClicks(signal)
    if (potentialClicks > 0) {
      const where = signal.position <= 10 ? 'on page one' : 'on the second results page'
      found.push({
        kind: 'striking_distance',
        keyword: signal.keyword,
        headline: `Ranks ${signal.position.toFixed(1)} (${where}) with ${signal.impressions.toLocaleString()} impressions — reaching the top 3 is worth about ${potentialClicks.toLocaleString()} more clicks.`,
        potentialClicks,
        score: scoreFor('striking_distance', potentialClicks, signal.impressions),
        actions: [
          'Deepen the page so it covers the question more completely than the results above it',
          'Add internal links to this page from related, well-linked pages',
          'Make sure the title and H1 target this query rather than a broader one',
        ],
        page,
      })
    }
  }

  // Slipping against the previous period.
  const previousPosition = signal.previousPosition ?? null
  const previousClicks = signal.previousClicks ?? 0
  const positionLost = previousPosition !== null ? signal.position - previousPosition : 0
  const clicksLost = previousClicks - signal.clicks
  const droppedSharply = previousClicks >= 10 && clicksLost / previousClicks >= CLICK_DROP_RATIO

  if (positionLost >= POSITION_DROP || droppedSharply) {
    const potentialClicks = Math.max(clicksLost, 0)
    found.push({
      kind: 'losing_ground',
      keyword: signal.keyword,
      headline:
        positionLost >= POSITION_DROP
          ? `Slipped from position ${previousPosition!.toFixed(1)} to ${signal.position.toFixed(1)} since the previous period.`
          : `Clicks fell from ${previousClicks.toLocaleString()} to ${signal.clicks.toLocaleString()} since the previous period.`,
      potentialClicks,
      score: scoreFor('losing_ground', Math.max(potentialClicks, 1), signal.impressions),
      actions: [
        'Check whether the ranking page changed recently',
        'Compare the page against the results now ranking above it',
        'Confirm the page is still reachable and indexable',
      ],
      page,
    })
  }

  return found
}

/** Classifies a whole set and returns the work worth doing first. */
export function rankOpportunities(signals: KeywordSignal[]): ClassifiedOpportunity[] {
  return signals
    .flatMap(classifyKeyword)
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score)
}

export interface CannibalizedQuery {
  keyword: string
  totalImpressions: number
  pages: { page: string; impressions: number; clicks: number; position: number | null }[]
}

/**
 * Two of your own pages competing for one query split the ranking signals
 * between them. The fix is a decision — merge, differentiate, or redirect —
 * so the recommendation names the pages rather than prescribing blindly.
 */
export function classifyCannibalization(query: CannibalizedQuery): ClassifiedOpportunity | null {
  if (query.pages.length < 2) return null

  const ranked = [...query.pages].sort((a, b) => b.impressions - a.impressions)
  const [primary, ...others] = ranked
  const splitImpressions = others.reduce((sum, p) => sum + p.impressions, 0)
  if (splitImpressions <= 0) return null

  // What the weaker pages would add if their demand reached the primary
  // page's click rate.
  const primaryCtr = primary.impressions > 0 ? primary.clicks / primary.impressions : 0
  const othersClicks = others.reduce((sum, p) => sum + p.clicks, 0)
  const potentialClicks = Math.max(0, Math.round(splitImpressions * primaryCtr - othersClicks))

  return {
    kind: 'cannibalization',
    keyword: query.keyword,
    headline: `${query.pages.length} of your pages rank for this query, splitting ${query.totalImpressions.toLocaleString()} impressions between them.`,
    potentialClicks,
    score: scoreFor('cannibalization', Math.max(potentialClicks, 1), query.totalImpressions),
    actions: [
      `Decide which page should own this query — currently ${primary.page} gets the most impressions`,
      'Merge the overlapping content into that page, or make each page target a clearly different query',
      'Point internal links for this topic at the page you chose',
    ],
    page: primary.page,
  }
}
