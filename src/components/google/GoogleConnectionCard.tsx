import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Link2, Loader2, RefreshCw, Unlink, XCircle } from 'lucide-react'
import {
  disconnectGoogle,
  listProperties,
  selectProperty,
  startGoogleConnect,
  syncSearchConsole,
  SYNC_RANGES,
  type SyncRange,
} from '@/lib/google/searchConsole'
import { useGoogleStatus } from '@/hooks/useGoogleStatus'
import type { SearchConsoleProperty } from '@/lib/database.types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Google connection panel. Without a projectId it manages only the account
 * link (Settings); with one it also handles property selection and sync for
 * that project.
 */
export function GoogleConnectionCard({ projectId, onSynced }: { projectId?: string; onSynced?: () => void }) {
  const { status, loading, error, refresh } = useGoogleStatus(projectId)
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [properties, setProperties] = React.useState<SearchConsoleProperty[] | null>(null)
  const [range, setRange] = React.useState<SyncRange>('28d')

  // The OAuth callback redirects back here with a result flag.
  React.useEffect(() => {
    const result = params.get('google')
    if (!result) return
    if (result === 'connected') setMessage('Google account connected.')
    else setFailure(`Google authorization failed (${params.get('reason') ?? 'unknown'}). Please try again.`)
    params.delete('google')
    params.delete('reason')
    setParams(params, { replace: true })
    refresh()
  }, [params, setParams, refresh])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setFailure(null)
    setMessage(null)
    try {
      await fn()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">Checking Google connection…</CardContent>
      </Card>
    )
  }

  if (error || !status) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-5">
          <p className="text-sm font-medium text-foreground">Google integration unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!status.serverConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Google Search Console</CardTitle>
          <CardDescription>
            Not set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Supabase Edge Function secrets to enable
            it — see the README for the Google Cloud steps.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">Google Search Console</CardTitle>
          <CardDescription>
            {status.connected
              ? `Connected as ${status.googleEmail ?? 'your Google account'}`
              : 'Import your real organic keywords, clicks, impressions and rankings.'}
          </CardDescription>
        </div>
        <Badge variant={status.connected ? 'success' : 'outline'}>
          {status.connected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
          {status.connected ? 'Connected' : 'Not connected'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {!status.connected ? (
          <Button
            variant="accent"
            disabled={busy === 'connect'}
            onClick={() =>
              run('connect', async () => {
                const url = await startGoogleConnect(`${window.location.origin}${window.location.pathname}`)
                window.location.href = url
              })
            }
          >
            {busy === 'connect' ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Connect Google
          </Button>
        ) : (
          <>
            {projectId && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Property</p>
                    <p className="truncate text-sm text-foreground">
                      {status.property?.property_url ?? 'No property selected for this project'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === 'properties'}
                    onClick={() => run('properties', async () => setProperties(await listProperties()))}
                  >
                    {busy === 'properties' ? <Loader2 className="size-4 animate-spin" /> : null}
                    {status.property ? 'Change' : 'Select property'}
                  </Button>
                </div>

                {properties && (
                  <div className="space-y-2">
                    {properties.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        This Google account has no Search Console properties. Verify your site in Search Console first.
                      </p>
                    ) : (
                      <Select
                        onValueChange={(value) =>
                          run('select', async () => {
                            await selectProperty(projectId, value)
                            setProperties(null)
                            setMessage('Property linked to this project.')
                            await refresh()
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a Search Console property" />
                        </SelectTrigger>
                        <SelectContent>
                          {properties.map((p) => (
                            <SelectItem key={p.id} value={p.property_url}>
                              {p.property_url}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

                {status.property && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={range} onValueChange={(v) => setRange(v as SyncRange)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SYNC_RANGES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="accent"
                      size="sm"
                      disabled={busy === 'sync'}
                      onClick={() =>
                        run('sync', async () => {
                          const result = await syncSearchConsole(projectId, range)
                          setMessage(
                            `Imported ${result.rows_imported ?? 0} rows (${result.date_from} → ${result.date_to}).`,
                          )
                          await refresh()
                          onSynced?.()
                        })
                      }
                    >
                      {busy === 'sync' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Sync now
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Last synchronized: {relativeTime(status.lastSync?.completed_at ?? null)}
                      {status.lastSync?.status === 'failed' && ' — last run failed'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              disabled={busy === 'disconnect'}
              onClick={() =>
                run('disconnect', async () => {
                  await disconnectGoogle()
                  setMessage('Google account disconnected.')
                  await refresh()
                })
              }
            >
              <Unlink className="size-4" /> Disconnect
            </Button>
          </>
        )}

        {message && <p className="text-xs text-success">{message}</p>}
        {failure && <p className="text-xs text-destructive">{failure}</p>}
      </CardContent>
    </Card>
  )
}
