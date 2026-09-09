/**
 * Opportunity Engine
 * ==================
 *
 * Scores how much organic traffic a keyword could realistically gain, using
 * only measured inputs: Search Console performance, and — where the crawler
 * already found them — on-page facts about the ranking page.
 *
 * The score is deterministic: the same inputs always produce the same value.
 *
 *   Opportunity Score = 100 x RankingPotential x ImpressionWeight x ClickGap
 *
 * RankingPotential  How much room there is to climb, discounted by how
 *                   realistic the climb is. Position 4-10 is the sweet spot:
 *                   already on page one, one push from the top. Position 70
 *                   scores low not because the upside is small but because
 *                   reaching the top from there rarely happens.
 *
 * ImpressionWeight  Demand actually observed for the query, log-scaled so a
 *                   20,000-impression keyword outranks a 200-impression one
 *                   without making everything else round to zero.
 *
 * ClickGap          Clicks currently being left on the table: the difference
 *                   between the clicks the page gets now and the clicks it
 *                   would get at position 3, saturating so that a handful of
 *                   enormous keywords cannot flatten the rest of the list.
 *
 * Tuning: adjust the three constants blocks below. Each is independent, so a
 * change to one does not silently distort the others.
 */

/**
 * Modelled click-through rate by position. This is a MODEL, not measured data
 * for any particular site — it exists only to estimate the size of the click
 * gap, and is never displayed as if it were a real metric. Replace with your
 * own curve if you have measured one.
 */
const CTR_BY_POSITION: Record<number, number> = {
  1: 0.27,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.06,
  6: 0.05,
  7: 0.04,
  8: 0.035,
  9: 0.03,
  10: 0.025,
}
const CTR_BEYOND_PAGE_ONE = 0.01

/** The position the engine assumes as a realistic improvement target. */
const TARGET_POSITION = 3

/** Impressions at which ImpressionWeight saturates to 1. */
const IMPRESSION_SATURATION = 50_000

/** Click gap at which ClickGap saturates toward 1. */
const CLICK_GAP_HALF_POINT = 100

export function modelledCtr(position: number): number {
  if (position < 1) return CTR_BY_POSITION[1]
  const rounded = Math.round(position)
  return CTR_BY_POSITION[rounded] ?? CTR_BEYOND_PAGE_ONE
}

export function rankingPotential(position: number): number {
  if (position <= 3) return 0.1
  if (position <= 10) return 1
  if (position <= 20) return 0.8
  if (position <= 50) return 0.4
  return 0.15
}

export function impressionWeight(impressions: number): number {
  if (impressions <= 0) return 0
  return Math.min(1, Math.log10(1 + impressions) / Math.log10(1 + IMPRESSION_SATURATION))
}

export interface OpportunityInput {
  keyword: string
  position: number | null
  impressions: number
  clicks: number
  ctr: number
  /** Google Ads monthly searches, when that integration has supplied it. */
  searchVolume?: number | null
}

export interface OpportunityResult {
  keyword: string
  score: number
  /** Additional monthly clicks if the keyword reached the target position. */
  potentialClicks: number
  impact: 'high' | 'medium' | 'low'
}

/** Extra clicks the keyword would earn at TARGET_POSITION, at today's demand. */
export function potentialClickGain(input: OpportunityInput): number {
  if (input.position === null || input.impressions <= 0) return 0
  if (input.position <= TARGET_POSITION) return 0
  const targetClicks = input.impressions * modelledCtr(TARGET_POSITION)
  return Math.max(0, Math.round(targetClicks - input.clicks))
}

export function computeOpportunityScore(input: OpportunityInput): OpportunityResult {
  const potentialClicks = potentialClickGain(input)

  if (input.position === null || input.impressions <= 0) {
    return { keyword: input.keyword, score: 0, potentialClicks: 0, impact: 'low' }
  }

  const clickGap = potentialClicks / (potentialClicks + CLICK_GAP_HALF_POINT)
  const raw = rankingPotential(input.position) * impressionWeight(input.impressions) * clickGap
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)))

  return {
    keyword: input.keyword,
    score,
    potentialClicks,
    impact: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low',
  }
}

/**
 * Quick wins: on page one or two, with demand already proven by impressions.
 * These are the keywords where a modest content or on-page change tends to
 * pay off fastest.
 */
export function isQuickWin(input: OpportunityInput): boolean {
  return input.position !== null && input.position >= 4 && input.position <= 20 && input.impressions >= 100
}

/** On-page facts the crawler recorded for the page a keyword ranks with. */
export interface CrawledPageFacts {
  title: string | null
  h1: string | null
  wordCount: number | null
  internalLinksCount: number
  imagesMissingAlt: number
  metaDescription: string | null
}

/**
 * Recommendations derived strictly from observed data. Nothing is suggested
 * unless the crawler actually recorded the underlying fact, so the engine
 * never invents a problem the audit did not find.
 */
export function recommendActions(input: OpportunityInput, page: CrawledPageFacts | null): string[] {
  const actions: string[] = []
  const keyword = input.keyword.toLowerCase()

  if (page) {
    if (!page.title) {
      actions.push('Add a title tag — this page has none')
    } else if (!page.title.toLowerCase().includes(keyword)) {
      actions.push(`Work "${input.keyword}" into the title tag, which does not currently mention it`)
    }

    if (!page.metaDescription) {
      actions.push('Write a meta description to improve the click-through rate from search results')
    }

    if (!page.h1) {
      actions.push('Add an H1 stating the page topic')
    } else if (!page.h1.toLowerCase().includes(keyword)) {
      actions.push(`Align the H1 with "${input.keyword}"`)
    }

    if (page.wordCount !== null && page.wordCount < 800) {
      actions.push(`Deepen the content — the crawler measured ${page.wordCount} words on this page`)
    }

    if (page.internalLinksCount < 5) {
      actions.push(
        `Add internal links to this page — the crawler found ${page.internalLinksCount} outgoing internal link${
          page.internalLinksCount === 1 ? '' : 's'
        } on it`,
      )
    }

    if (page.imagesMissingAlt > 0) {
      actions.push(`Add alt text to ${page.imagesMissingAlt} image${page.imagesMissingAlt === 1 ? '' : 's'}`)
    }
  }

  // CTR is measured, so this recommendation stands on its own.
  if (input.position !== null && input.position <= 10 && input.ctr < modelledCtr(input.position) / 2) {
    actions.push(
      'Rewrite the title and meta description: the page ranks on page one but is clicked far less often than that position usually earns',
    )
  }

  if (actions.length === 0) {
    actions.push('Review how well the page matches what someone searching this keyword actually wants')
  }

  return actions
}

/** Plain-language explanation of why a keyword surfaced as an opportunity. */
export function explainOpportunity(input: OpportunityInput, result: OpportunityResult): string {
  const position = input.position?.toFixed(1) ?? '—'
  if (input.position !== null && input.position > 10) {
    return `This page receives ${input.impressions.toLocaleString()} impressions but ranks at position ${position}, outside the top 10. Reaching position ${TARGET_POSITION} would be worth roughly ${result.potentialClicks.toLocaleString()} more clicks at today's demand.`
  }
  return `This keyword already ranks at position ${position} with ${input.impressions.toLocaleString()} impressions. Closing the gap to position ${TARGET_POSITION} would be worth roughly ${result.potentialClicks.toLocaleString()} more clicks.`
}
