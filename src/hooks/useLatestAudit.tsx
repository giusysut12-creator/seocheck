import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { SiteAudit } from '@/lib/database.types'

export function useLatestAudit(projectId: string | undefined) {
  const [audit, setAudit] = React.useState<SiteAudit | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!projectId) return
    const { data } = await supabase
      .from('site_audits')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setAudit((data as SiteAudit) ?? null)
    setLoading(false)
  }, [projectId])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  React.useEffect(() => {
    if (audit?.status !== 'crawling' && audit?.status !== 'pending') return
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [audit?.status, refresh])

  return { audit, loading, refresh }
}
