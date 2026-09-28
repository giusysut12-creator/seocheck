import { supabase } from '@/lib/supabase'
import { normalizeUrl } from '@/lib/utils'

/**
 * Which opportunities have already been published to the user's site.
 *
 * Opportunities are recomputed from Search Console on every visit, so one
 * that has been fixed reappears unchanged until Google re-crawls the page
 * and reports a new position — weeks later. Without this the list keeps
 * offering work that is already done, and the user has no way to tell the
 * difference.
 */
export interface AppliedFix {
  keyword: string
  kind: string
  pageUrl: string | null
  appliedAt: string
}

/**
 * Identifies an opportunity the same way the list does: a keyword, the kind
 * of problem, and the page it is about. The page is normalized because
 * Search Console and the crawler report the same URL differently, and a
 * fix recorded under one spelling must still match the other.
 */
export function appliedFixKey(input: { keyword: string; kind: string; page: string | null }): string {
  return `${input.kind}|${input.keyword.toLowerCase()}|${input.page ? normalizeUrl(input.page) : ''}`
}

/** Every fix published for this project, newest first per opportunity. */
export async function fetchAppliedFixes(projectId: string): Promise<Map<string, AppliedFix>> {
  const { data, error } = await supabase
    .from('applied_fixes')
    .select('keyword, kind, page_url, applied_at')
    .eq('project_id', projectId)
    .order('applied_at', { ascending: false })

  // A project whose database predates this table should still show its
  // opportunities, just without the "already fixed" marks.
  if (error || !data) return new Map()

  const byKey = new Map<string, AppliedFix>()
  for (const row of data as { keyword: string; kind: string; page_url: string | null; applied_at: string }[]) {
    const key = appliedFixKey({ keyword: row.keyword, kind: row.kind, page: row.page_url })
    if (!byKey.has(key)) {
      byKey.set(key, { keyword: row.keyword, kind: row.kind, pageUrl: row.page_url, appliedAt: row.applied_at })
    }
  }
  return byKey
}

/**
 * Records a fix that reached the user's site. Called after the publish
 * succeeds, never before: this table is a log of what happened, and a row
 * written for a failed publish would hide an opportunity that is still open.
 */
export async function recordAppliedFix(
  projectId: string,
  fix: { keyword: string; kind: string; page: string | null; title: string | null; metaDescription: string | null },
): Promise<void> {
  await supabase.from('applied_fixes').insert({
    project_id: projectId,
    keyword: fix.keyword,
    kind: fix.kind,
    page_url: fix.page,
    title: fix.title,
    meta_description: fix.metaDescription,
  })
}

/**
 * How a published fix has performed since it went live.
 *
 * Deliberately reports how many days of data exist on each side. Google
 * takes weeks to re-crawl a page and report a new position, and its own
 * reporting runs about three days behind, so an early verdict is noise.
 * The caller decides what is enough; this never hides the sample size.
 */
export interface FixOutcome {
  keyword: string
  kind: string
  pageUrl: string | null
  appliedAt: string
  before: { clicks: number; impressions: number; position: number | null; days: number }
  after: { clicks: number; impressions: number; position: number | null; days: number }
}

/**
 * Before and after for every published fix, measured on the same keyword and
 * page. Per-day rates, not totals: the two windows rarely cover the same
 * number of days, and comparing their totals would read as a gain whenever
 * the "after" window is simply longer.
 */
export async function fetchFixOutcomes(projectId: string): Promise<FixOutcome[]> {
  const { data, error } = await supabase.rpc('applied_fix_outcomes', { p_project_id: projectId })
  if (error || !data) return []

  return (data as Record<string, string | number | null>[]).map((row) => ({
    keyword: String(row.keyword),
    kind: String(row.kind),
    pageUrl: (row.page_url as string | null) ?? null,
    appliedAt: String(row.applied_at),
    before: {
      clicks: Number(row.before_clicks ?? 0),
      impressions: Number(row.before_impressions ?? 0),
      position: row.before_position === null ? null : Number(row.before_position),
      days: Number(row.before_days ?? 0),
    },
    after: {
      clicks: Number(row.after_clicks ?? 0),
      impressions: Number(row.after_impressions ?? 0),
      position: row.after_position === null ? null : Number(row.after_position),
      days: Number(row.after_days ?? 0),
    },
  }))
}

/** Google needs weeks; below this many days of data any verdict is noise. */
export const MIN_DAYS_FOR_VERDICT = 14

export type FixVerdict = 'too_early' | 'no_baseline' | 'improved' | 'unchanged' | 'worse'

/**
 * What the numbers support saying, and nothing more. "Unchanged" covers
 * movement under half a position: Search Console's average position wobbles
 * by that much on its own, and calling that an improvement would be reading
 * a result into noise.
 */
export function verdictFor(outcome: FixOutcome): FixVerdict {
  if (outcome.after.days < MIN_DAYS_FOR_VERDICT) return 'too_early'
  if (outcome.before.days === 0 || outcome.before.position === null || outcome.after.position === null) {
    return 'no_baseline'
  }
  const change = outcome.before.position - outcome.after.position
  if (change > 0.5) return 'improved'
  if (change < -0.5) return 'worse'
  return 'unchanged'
}
