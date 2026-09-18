import * as React from 'react'
import { getGoogleStatus, type GoogleStatus } from '@/lib/google/searchConsole'

export function useGoogleStatus(projectId?: string) {
  const [status, setStatus] = React.useState<GoogleStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      setError(null)
      setStatus(await getGoogleStatus(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Non è stato possibile leggere lo stato della connessione Google')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  return { status, loading, error, refresh }
}
