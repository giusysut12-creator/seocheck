import * as React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { startCrawl } from '@/lib/edgeFunctions'
import { syncSearchConsole, type SyncRange } from '@/lib/google/searchConsole'
import { Button } from '@/components/ui/button'

/**
 * Re-checks the site after acting on a recommendation.
 *
 * The two halves update on very different timescales, and conflating them
 * would make the button look broken: re-crawling confirms an on-page edit
 * within a minute, while Search Console only reflects a change once Google
 * has re-measured it — days, sometimes weeks. The result text says which is
 * which rather than implying both refreshed.
 */
export function RescanButton({
  projectId,
  range,
  onDone,
  syncSearchConsoleToo = true,
}: {
  projectId: string
  range: SyncRange
  onDone: () => void
  syncSearchConsoleToo?: boolean
}) {
  const [phase, setPhase] = React.useState<'idle' | 'crawling' | 'syncing'>('idle')
  const [progress, setProgress] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function rescan() {
    setResult(null)
    setError(null)

    setPhase('crawling')
    setProgress(null)
    let slowNote = ''
    const { data: crawl, error: crawlError } = await startCrawl(projectId, (p) => {
      setProgress(p.pending > 0 ? `${p.crawled} di ${p.total} pagine` : `${p.crawled} pagine`)
      // Worth explaining: a site asking for a pause between requests makes
      // the crawl legitimately slow, and that is not a fault to hide.
      if (p.crawlDelaySeconds > 0) {
        slowNote = ` Il tuo robots.txt chiede ai crawler di attendere ${p.crawlDelaySeconds}s tra le richieste, quindi ci vorrà un po'.`
      }
    })
    if (crawlError) {
      setPhase('idle')
      // The count stays on screen: the crawl is resumable, so what it reached
      // before stopping is the useful half of the answer.
      setError(crawlError)
      return
    }

    const coverage = `Scansionate ${crawl?.pages_crawled ?? 0} pagine.${slowNote}`

    let syncedNote = ''
    if (syncSearchConsoleToo) {
      setPhase('syncing')
      try {
        await syncSearchConsole(projectId, range)
        syncedNote = ' Anche i dati di Search Console sono stati aggiornati, anche se Google richiede alcuni giorni per riflettere le modifiche appena fatte.'
      } catch (err) {
        // A failed sync does not invalidate the crawl that already succeeded.
        syncedNote = ` Non è stato possibile aggiornare Search Console: ${err instanceof Error ? err.message : 'errore sconosciuto'}`
      }
    }

    setPhase('idle')
    setProgress(null)
    setResult(`${coverage} Le modifiche on-page sono riportate qui sotto.${syncedNote}`)
    onDone()
  }

  const busy = phase !== 'idle'

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={rescan} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {phase === 'crawling'
          ? progress
            ? `Nuova scansione ${progress}…`
            : 'Nuova scansione…'
          : phase === 'syncing'
            ? 'Aggiornamento Search Console…'
            : 'Rianalizza'}
      </Button>
      {result && <p className="max-w-md text-right text-xs text-success">{result}</p>}
      {error && (
        <div className="max-w-md text-right">
          <p className="text-xs text-destructive">{error}</p>
          {progress && <p className="text-xs text-muted-foreground">Raggiunte {progress} prima di fermarsi.</p>}
        </div>
      )}
    </div>
  )
}
