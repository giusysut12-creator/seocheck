import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { SiteAudit } from '@/lib/database.types'

/**
 * A crawl is driven from the browser, one slice at a time. Close the tab and
 * the run simply stops — the row stays `crawling` for ever, nothing ever
 * finishes it. The page then polls a dead run and shows "Scansione in
 * corso…" indefinitely, while every result on the screen comes from that
 * empty run rather than from the completed one before it.
 *
 * A run writes its progress after every slice, so a few minutes of silence
 * means the driver is gone, not that the site is slow.
 */
const STALE_AFTER_MS = 4 * 60 * 1000

export interface LatestAudit {
  /** The most recent run, whatever state it is in. */
  audit: SiteAudit | null
  /**
   * The most recent run that actually finished. Scores, issues and page
   * counts come from here: an abandoned run must not blank a screen whose
   * data is still perfectly good.
   */
  completed: SiteAudit | null
  /** The latest run claims to be crawling but has stopped reporting. */
  isStale: boolean
  loading: boolean
  refresh: () => Promise<void>
}

function isRunning(audit: SiteAudit | null): boolean {
  return audit?.status === 'crawling' || audit?.status === 'pending'
}

export function useLatestAudit(projectId: string | undefined): LatestAudit {
  const [audit, setAudit] = React.useState<SiteAudit | null>(null)
  const [completed, setCompleted] = React.useState<SiteAudit | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [isStale, setStale] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!projectId) return
    const [latest, lastCompleted] = await Promise.all([
      supabase
        .from('site_audits')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('site_audits')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const row = (latest.data as SiteAudit) ?? null
    setAudit(row)
    setCompleted((lastCompleted.data as SiteAudit) ?? null)
    setStale(
      isRunning(row) && row !== null && Date.now() - new Date(row.updated_at).getTime() > STALE_AFTER_MS,
    )
    setLoading(false)
  }, [projectId])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  React.useEffect(() => {
    // Polling a run nobody is driving never ends and never changes anything.
    if (!isRunning(audit) || isStale) return
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [audit, isStale, refresh])

  return { audit, completed, isStale, loading, refresh }
}
