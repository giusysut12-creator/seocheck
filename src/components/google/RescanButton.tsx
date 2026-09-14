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
    const { data: crawl, error: crawlError } = await startCrawl(projectId, (p) => {
      setProgress(p.pending > 0 ? `${p.crawled} of ${p.total} pages` : `${p.crawled} pages`)
    })
    if (crawlError) {
      setPhase('idle')
      setProgress(null)
      setError(crawlError)
      return
    }

    const coverage = `Crawled ${crawl?.pages_crawled ?? 0} pages.`

    let syncedNote = ''
    if (syncSearchConsoleToo) {
      setPhase('syncing')
      try {
        await syncSearchConsole(projectId, range)
        syncedNote = ' Search Console data refreshed too, though Google needs a few days to reflect changes you just made.'
      } catch (err) {
        // A failed sync does not invalidate the crawl that already succeeded.
        syncedNote = ` Search Console could not be refreshed: ${err instanceof Error ? err.message : 'unknown error'}`
      }
    }

    setPhase('idle')
    setProgress(null)
    setResult(`${coverage} On-page changes are reflected below.${syncedNote}`)
    onDone()
  }

  const busy = phase !== 'idle'

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={rescan} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {phase === 'crawling'
          ? progress
            ? `Re-crawling ${progress}…`
            : 'Re-crawling…'
          : phase === 'syncing'
            ? 'Refreshing Search Console…'
            : 'Rescan'}
      </Button>
      {result && <p className="max-w-md text-right text-xs text-success">{result}</p>}
      {error && <p className="max-w-md text-right text-xs text-destructive">{error}</p>}
    </div>
  )
}
