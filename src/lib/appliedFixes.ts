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
