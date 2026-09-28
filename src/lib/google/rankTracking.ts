import { supabase } from '@/lib/supabase'

/**
 * Rank tracking from Search Console instead of a paid data provider.
 *
 * A third-party rank tracker guesses where a site sits by scraping results
 * from one place on one device. Search Console reports where Google put the
 * page for the people who actually searched. For the user's own site that
 * is the better number — and unlike the provider it is already paid for.
 *
 * What it cannot do, and what the UI has to keep saying: a query the site
 * has never appeared for has no position to report, and neither
 * competitors' positions nor search volume are in here at all.
 */

export interface GscPosition {
  keyword: string
  date: string
  position: number | null
  clicks: number
  impressions: number
  topPage: string | null
}

export async function fetchKeywordPositions(
  projectId: string,
  keywords: string[],
  days = 90,
): Promise<GscPosition[]> {
  if (keywords.length === 0) return []
  const { data, error } = await supabase.rpc('gsc_keyword_positions', {
    p_project_id: projectId,
    p_keywords: keywords,
    p_days: days,
  })
  if (error || !data) return []

  return (data as Record<string, string | number | null>[]).map((row) => ({
    keyword: String(row.keyword),
    date: String(row.date),
    position: row.position === null ? null : Number(row.position),
    clicks: Number(row.clicks ?? 0),
    impressions: Number(row.impressions ?? 0),
    topPage: (row.top_page as string | null) ?? null,
  }))
}

/** One day of a keyword's history, ready for the keyword_rankings table. */
export interface RankingRow {
  keyword_id: string
  date: string
  position: number | null
  previous_position: number | null
  best_position: number | null
  url: string | null
}

/**
 * Turns Search Console's daily rows into ranking history.
 *
 * Positions are rounded to whole places on the way in: the table holds
 * integers, and "4.3" is an average across a day's searches rather than a
 * position anyone was ever shown.
 *
 * `previous_position` and `best_position` are computed across the whole
 * series rather than against whatever happened to be stored, so a re-sync
 * produces the same history instead of a different one.
 */
export function toRankingRows(keywordId: string, positions: GscPosition[]): RankingRow[] {
  const ordered = [...positions].sort((a, b) => a.date.localeCompare(b.date))
  const rows: RankingRow[] = []
  let previous: number | null = null
  let best: number | null = null

  for (const point of ordered) {
    const position = point.position === null ? null : Math.round(point.position)
    if (position !== null) best = best === null ? position : Math.min(best, position)
    rows.push({
      keyword_id: keywordId,
      date: point.date,
      position,
      previous_position: previous,
      best_position: best,
      url: point.topPage,
    })
    if (position !== null) previous = position
  }

  return rows
}

/**
 * Fills a project's ranking history from Search Console. Returns how many
 * days were written, and which keywords Google had nothing for — those are
 * not failures to hide: a keyword the site has never ranked for is a real
 * answer, and pretending otherwise is how a tool starts inventing numbers.
 */
export async function syncRankingsFromSearchConsole(
  projectId: string,
  keywords: { id: string; keyword: string }[],
  days = 90,
): Promise<{ daysWritten: number; withoutData: string[] }> {
  const positions = await fetchKeywordPositions(projectId, keywords.map((k) => k.keyword), days)

  const byKeyword = new Map<string, GscPosition[]>()
  for (const point of positions) {
    const list = byKeyword.get(point.keyword) ?? []
    list.push(point)
    byKeyword.set(point.keyword, list)
  }

  const rows: RankingRow[] = []
  const withoutData: string[] = []
  for (const kw of keywords) {
    const points = byKeyword.get(kw.keyword) ?? []
    if (points.length === 0) {
      withoutData.push(kw.keyword)
      continue
    }
    rows.push(...toRankingRows(kw.id, points))
  }

  if (rows.length > 0) {
    await supabase.from('keyword_rankings').upsert(rows, { onConflict: 'keyword_id,date' })
  }

  return { daysWritten: rows.length, withoutData }
}
