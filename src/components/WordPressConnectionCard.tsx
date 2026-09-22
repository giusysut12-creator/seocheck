import * as React from 'react'
import { CheckCircle2, Globe, Loader2, Unlink, XCircle } from 'lucide-react'
import {
  connectWordPress,
  disconnectWordPress,
  getWordPressStatus,
  SEO_PLUGINS,
  type SeoPlugin,
  type WordPressStatus,
} from '@/lib/wordpress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'

/**
 * Phase 1 of "Applica al sito": stores and verifies a WordPress connection
 * for one project. This card never writes to the user's site — it only
 * checks that the given Application Password can authenticate, and saves it
 * for a later apply step to use. See wordpress-connect/index.ts.
 */
export function WordPressConnectionCard({ projectId }: { projectId: string }) {
  const [status, setStatus] = React.useState<WordPressStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  const [siteUrl, setSiteUrl] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [appPassword, setAppPassword] = React.useState('')
  const [seoPlugin, setSeoPlugin] = React.useState<SeoPlugin>('yoast')

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await getWordPressStatus(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Non è stato possibile leggere lo stato della connessione WordPress')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await connectWordPress(projectId, { siteUrl, username, appPassword, seoPlugin })
      setMessage('Sito WordPress connesso.')
      setAppPassword('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connessione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await disconnectWordPress(projectId)
      setMessage('Sito WordPress disconnesso.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnessione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">Verifica della connessione WordPress…</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Globe className="size-4" /> WordPress
          </CardTitle>
          <CardDescription>
            {status?.connected
              ? `Connesso a ${status.siteUrl}`
              : "Connetti il tuo sito per applicare in un click le correzioni generate dall'AI."}
          </CardDescription>
        </div>
        <Badge variant={status?.connected ? 'success' : 'outline'}>
          {status?.connected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
          {status?.connected ? 'Connesso' : 'Non connesso'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {status?.connected ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Utente</p>
                <p className="text-foreground">{status.username}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Plugin SEO</p>
                <p className="text-foreground">{SEO_PLUGINS.find((p) => p.value === status.seoPlugin)?.label ?? '—'}</p>
              </div>
              {status.lastVerifiedAt && (
                <div>
                  <p className="text-xs text-muted-foreground">Verificato</p>
                  <p className="text-foreground">{formatDate(status.lastVerifiedAt)}</p>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={handleDisconnect}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />} Disconnetti
            </Button>
          </>
        ) : (
          <form onSubmit={handleConnect} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Non usare la tua password di accesso normale. Genera una{' '}
              <strong className="font-medium text-foreground">Password per le applicazioni</strong> dal tuo sito: nel
              pannello admin vai su <strong className="font-medium text-foreground">Utenti → Il tuo profilo</strong>,
              scorri fino in fondo a "Password per le applicazioni", dai un nome (es. "SEO Check") e clicca "Aggiungi
              nuova". Copia la password mostrata — funziona solo per scrivere pagine/articoli e la puoi revocare in
              qualsiasi momento da lì.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="wp-site-url">Indirizzo del sito</Label>
              <Input
                id="wp-site-url"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://www.shophomegames.it"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wp-username">Nome utente WordPress</Label>
                <Input id="wp-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wp-app-password">Password per le applicazioni</Label>
                <Input
                  id="wp-app-password"
                  type="password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Plugin SEO che usi</Label>
              <Select value={seoPlugin} onValueChange={(v) => setSeoPlugin(v as SeoPlugin)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEO_PLUGINS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Connetti sito
            </Button>
          </form>
        )}

        {message && <p className="text-xs text-success">{message}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
