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
  if (!iso) return 'mai'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'proprio ora'
  if (minutes < 60) return `${minutes} minut${minutes === 1 ? 'o' : 'i'} fa`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} or${hours === 1 ? 'a' : 'e'} fa`
  const days = Math.round(hours / 24)
  return `${days} giorn${days === 1 ? 'o' : 'i'} fa`
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
    if (result === 'connected') setMessage('Account Google connesso.')
    else setFailure(`Autorizzazione Google non riuscita (${params.get('reason') ?? 'sconosciuto'}). Riprova.`)
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
      setFailure(err instanceof Error ? err.message : 'Qualcosa è andato storto')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">Verifica della connessione Google…</CardContent>
      </Card>
    )
  }

  if (error || !status) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-5">
          <p className="text-sm font-medium text-foreground">Integrazione Google non disponibile</p>
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
            Non ancora configurato. Aggiungi GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET come variabili segrete della
            Edge Function Supabase per attivarlo — vedi il README per i passaggi su Google Cloud.
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
              ? `Connesso come ${status.googleEmail ?? 'il tuo account Google'}`
              : 'Importa le tue vere parole chiave organiche, clic, impressioni e posizionamenti.'}
          </CardDescription>
        </div>
        <Badge variant={status.connected ? 'success' : 'outline'}>
          {status.connected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
          {status.connected ? 'Connesso' : 'Non connesso'}
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
            Connetti Google
          </Button>
        ) : (
          <>
            {projectId && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proprietà</p>
                    <p className="truncate text-sm text-foreground">
                      {status.property?.property_url ?? 'Nessuna proprietà selezionata per questo progetto'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === 'properties'}
                    onClick={() => run('properties', async () => setProperties(await listProperties()))}
                  >
                    {busy === 'properties' ? <Loader2 className="size-4 animate-spin" /> : null}
                    {status.property ? 'Cambia' : 'Seleziona proprietà'}
                  </Button>
                </div>

                {properties && (
                  <div className="space-y-2">
                    {properties.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Questo account Google non ha proprietà Search Console. Verifica prima il tuo sito in Search Console.
                      </p>
                    ) : (
                      <Select
                        onValueChange={(value) =>
                          run('select', async () => {
                            await selectProperty(projectId, value)
                            setProperties(null)
                            setMessage('Proprietà collegata a questo progetto.')
                            await refresh()
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona una proprietà Search Console" />
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
                            `Importate ${result.rows_imported ?? 0} righe (${result.date_from} → ${result.date_to}).`,
                          )
                          await refresh()
                          onSynced?.()
                        })
                      }
                    >
                      {busy === 'sync' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Sincronizza ora
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Ultima sincronizzazione: {relativeTime(status.lastSync?.completed_at ?? null)}
                      {status.lastSync?.status === 'failed' && ' — ultimo tentativo non riuscito'}
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
                  setMessage('Account Google disconnesso.')
                  await refresh()
                })
              }
            >
              <Unlink className="size-4" /> Disconnetti
            </Button>
          </>
        )}

        {message && <p className="text-xs text-success">{message}</p>}
        {failure && <p className="text-xs text-destructive">{failure}</p>}
      </CardContent>
    </Card>
  )
}
