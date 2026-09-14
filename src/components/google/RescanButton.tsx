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
  const [result, setResult] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function rescan() {
    setResult(null)
    setError(null)

    setPhase('crawling')
    const { data: crawl, error: crawlError } = await startCrawl(projectId)
    if (crawlError) {
      setPhase('idle')
      setError(crawlError)
      return
    }

    // A crawl that stopped at its time budget covered part of the site, which
    // is worth saying plainly rather than presenting as a full audit.
    const coverage = crawl?.truncated
      ? `Crawled ${crawl.pages_crawled ?? 0} pages before reaching the time limit, with ${crawl.urls_pending ?? 0} still queued — run it again to continue.`
      : `Crawled ${crawl?.pages_crawled ?? 0} pages.`

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
    setResult(`${coverage} On-page changes are reflected below.${syncedNote}`)
    onDone()
  }

  const busy = phase !== 'idle'

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={rescan} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {phase === 'crawling' ? 'Re-crawling…' : phase === 'syncing' ? 'Refreshing Search Console…' : 'Rescan'}
      </Button>
      {result && <p className="max-w-md text-right text-xs text-success">{result}</p>}
      {error && <p className="max-w-md text-right text-xs text-destructive">{error}</p>}
    </div>
  )
}
