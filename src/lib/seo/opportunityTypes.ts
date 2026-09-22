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

/**
 * Below this, a period's numbers are noise rather than a signal. Kept low on
 * purpose: on a smaller site a query with a few dozen impressions is still
 * worth knowing about, and the score already sinks low-demand keywords to the
 * bottom of the list. A high cut-off here would hide them entirely instead.
 */
const MIN_IMPRESSIONS = 30

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
  /**
   * Set only for `cannibalization`: every page competing for the keyword,
   * `page` included. What makes this kind different from a simple rewrite —
   * without it, a consumer has no way to tell "rewrite this page's snippet"
   * apart from "these five pages are splitting the same query".
   */
  competingPages?: { page: string; impressions: number; clicks: number; position: number | null }[]
}

export const KIND_LABELS: Record<OpportunityKind, { label: string; blurb: string }> = {
  ctr_gap: {
    label: 'Riscrivi lo snippet',
    blurb: 'Si posiziona bene ma viene cliccato raramente — il testo dell\'annuncio è il collo di bottiglia, non la posizione.',
  },
  striking_distance: {
    label: 'Alla portata',
    blurb: 'Abbastanza vicino alla vetta che una spinta mirata può portarlo in posizioni che generano clic.',
  },
  losing_ground: {
    label: 'Perdita di terreno',
    blurb: 'In calo rispetto al periodo precedente — vale la pena difenderlo prima che la perdita si consolidi.',
  },
  cannibalization: {
    label: 'In competizione con se stesso',
    blurb: 'Diverse tue pagine si posizionano per questa query, dividendo i segnali tra loro.',
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
        headline: `Posizione ${signal.position.toFixed(1)} ma solo ${(signal.ctr * 100).toFixed(1)}% di clic — quella posizione normalmente ne ottiene circa ${(expectedCtr * 100).toFixed(0)}%.`,
        potentialClicks,
        score: scoreFor('ctr_gap', potentialClicks, signal.impressions),
        actions: [
          'Riscrivi il tag title in modo che risponda direttamente a questa query',
          'Scrivi una meta description che dia un motivo per scegliere questo risultato',
          'Verifica che la pagina corrisponda ancora a ciò che cerca chi digita questa query',
        ],
        page,
      })
    }
  }

  // Close enough to the top that improvement is realistic.
  if (signal.position >= 4 && signal.position <= 20) {
    const potentialClicks = climbClicks(signal)
    if (potentialClicks > 0) {
      const where = signal.position <= 10 ? 'in prima pagina' : 'nella seconda pagina dei risultati'
      found.push({
        kind: 'striking_distance',
        keyword: signal.keyword,
        headline: `Posizionata ${signal.position.toFixed(1)} (${where}) con ${signal.impressions.toLocaleString()} impressioni — raggiungere il top 3 vale circa ${potentialClicks.toLocaleString()} clic in più.`,
        potentialClicks,
        score: scoreFor('striking_distance', potentialClicks, signal.impressions),
        actions: [
          'Approfondisci la pagina così che copra la domanda più completamente dei risultati sopra di essa',
          'Aggiungi link interni a questa pagina da pagine correlate e ben collegate',
          'Assicurati che titolo e H1 puntino a questa query specifica e non a una più generica',
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
          ? `Scesa dalla posizione ${previousPosition!.toFixed(1)} a ${signal.position.toFixed(1)} rispetto al periodo precedente.`
          : `I clic sono scesi da ${previousClicks.toLocaleString()} a ${signal.clicks.toLocaleString()} rispetto al periodo precedente.`,
      potentialClicks,
      score: scoreFor('losing_ground', Math.max(potentialClicks, 1), signal.impressions),
      actions: [
        'Verifica se la pagina posizionata è cambiata di recente',
        'Confronta la pagina con i risultati ora posizionati sopra di essa',
        'Conferma che la pagina sia ancora raggiungibile e indicizzabile',
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
    headline: `${query.pages.length} tue pagine si posizionano per questa query, dividendo ${query.totalImpressions.toLocaleString()} impressioni tra loro.`,
    potentialClicks,
    score: scoreFor('cannibalization', Math.max(potentialClicks, 1), query.totalImpressions),
    actions: [
      `Decidi quale pagina dovrebbe possedere questa query — attualmente ${primary.page} ottiene più impressioni`,
      'Unisci il contenuto sovrapposto in quella pagina, oppure rendi ogni pagina mirata a una query chiaramente diversa',
      'Punta i link interni per questo argomento verso la pagina che hai scelto',
    ],
    page: primary.page,
    competingPages: ranked,
  }
}
