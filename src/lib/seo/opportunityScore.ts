import type { OrganicKeywordResult } from '@/lib/seo/types'

/**
 * Opportunity Score (0-100) = Search Volume x ranking potential x business
 * relevance / difficulty, normalized. Ranking potential is highest for
 * keywords already positioned 4-20 (page-1/2, room to climb). Business
 * relevance defaults to 1 for non-branded commercial/transactional intent
 * (where ranking gains translate most directly into value) and slightly
 * lower otherwise.
 */
export function computeOpportunityScore(kw: OrganicKeywordResult): number {
  const volume = kw.searchVolume ?? 0
  const difficulty = Math.max(1, kw.difficulty ?? 50)

  let rankingPotential = 0.2
  if (kw.position >= 4 && kw.position <= 10) rankingPotential = 1
  else if (kw.position > 10 && kw.position <= 20) rankingPotential = 0.8
  else if (kw.position > 20 && kw.position <= 50) rankingPotential = 0.4

  const relevance = kw.searchIntent === 'commercial' || kw.searchIntent === 'transactional' ? 1 : kw.isBranded ? 0.3 : 0.7

  const raw = (volume * rankingPotential * relevance) / difficulty
  // Normalize with a soft cap so a handful of very high-volume keywords
  // don't blow every other score down toward zero.
  const normalized = Math.min(100, Math.round((raw / (raw + 40)) * 100))
  return normalized
}

export function isKeywordOpportunity(kw: OrganicKeywordResult): boolean {
  return kw.position >= 4 && kw.position <= 20 && (kw.searchVolume ?? 0) > 0
}
