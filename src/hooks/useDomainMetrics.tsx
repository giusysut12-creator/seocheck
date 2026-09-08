import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { Domain, DomainMetric } from '@/lib/database.types'

export function useDomainMetrics(projectId: string | undefined) {
  const [domain, setDomain] = React.useState<Domain | null>(null)
  const [history, setHistory] = React.useState<DomainMetric[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: domainData } = await supabase
        .from('domains')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_primary', true)
        .maybeSingle()
      if (cancelled) return
      setDomain((domainData as Domain) ?? null)

      if (domainData) {
        const { data: metrics } = await supabase
          .from('domain_metrics')
          .select('*')
          .eq('domain_id', (domainData as Domain).id)
          .order('date', { ascending: true })
          .limit(90)
        if (!cancelled) setHistory((metrics as DomainMetric[]) ?? [])
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const latestProvider = [...history].reverse().find((m) => m.source === 'provider') ?? null
  const previousProvider = [...history].reverse().filter((m) => m.source === 'provider')[1] ?? null

  return { domain, history, latestProvider, previousProvider, loading }
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}
