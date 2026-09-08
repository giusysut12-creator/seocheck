import * as React from 'react'
import { seoProvider } from '@/lib/seo/seoApiProvider'
import { checkProviderConfigured } from '@/lib/seo/seoApiProvider'
import type { OrganicKeywordResult } from '@/lib/seo/types'
import type { Project } from '@/lib/database.types'

export function useOrganicKeywords(project: Project | null) {
  const [keywords, setKeywords] = React.useState<OrganicKeywordResult[]>([])
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!project) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const isConfigured = await checkProviderConfigured()
        if (cancelled) return
        setConfigured(isConfigured)
        if (!isConfigured) {
          setKeywords([])
          return
        }
        const data = await seoProvider.getOrganicKeywords(project!.domain, {
          country: project!.country,
          device: project!.device,
          limit: 500,
        })
        if (!cancelled) setKeywords(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load keyword data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [project])

  return { keywords, configured, loading, error }
}
