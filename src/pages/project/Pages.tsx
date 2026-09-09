import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { dateWindow, fetchPagePerformance, type GscPageRow } from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import type { Page } from '@/lib/database.types'
import { EmptyState } from '@/components/EmptyState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/lib/utils'

/**
 * A page as the product sees it: what the crawler found on it, joined with
 * what Search Console measured for it. The two sources are matched on the
 * normalized URL, since the crawler stores raw URLs.
 */
export interface MergedPage {
  /** Present when the crawler has seen this URL. */
  crawled: Page | null
  /** Present when Search Console reported traffic for it. */
  organic: GscPageRow | null
  url: string
  urlNormalized: string
}

export function mergePagesWithOrganic(crawled: Page[], organic: GscPageRow[]): MergedPage[] {
  const byNormalized = new Map<string, MergedPage>()

  for (const page of crawled) {
    const key = page.url_normalized ?? page.url.toLowerCase()
    byNormalized.set(key, { crawled: page, organic: null, url: page.url, urlNormalized: key })
  }

  for (const row of organic) {
    const key = row.page_normalized
    const existing = byNormalized.get(key)
    if (existing) {
      existing.organic = row
    } else {
      // Search Console knows about a URL the crawler never reached — worth
      // showing rather than hiding, since it is earning impressions.
      byNormalized.set(key, { crawled: null, organic: row, url: row.page, urlNormalized: key })
    }
  }

  return Array.from(byNormalized.values()).sort(
    (a, b) => (b.organic?.clicks ?? -1) - (a.organic?.clicks ?? -1),
  )
}

/** Technical problems the crawler actually recorded for a page. */
export function pageIssueCount(page: Page | null): number {
  if (!page) return 0
  let count = 0
  if (!page.title) count++
  if (!page.meta_description) count++
  if (page.h1_count === 0 || page.h1_count > 1) count++
  if (page.images_missing_alt_count > 0) count++
  if (!page.is_indexable) count++
  if ((page.status_code ?? 200) >= 400) count++
  if (page.word_count !== null && page.word_count < 300) count++
  return count
}

export default function Pages() {
  const { project, id } = useCurrentProject()
  const navigate = useNavigate()
  const [range, setRange] = React.useState<SyncRange>('28d')
  const [merged, setMerged] = React.useState<MergedPage[]>([])
  const [loading, setLoading] = React.useState(true)
  const [hasOrganic, setHasOrganic] = React.useState(false)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: crawledRows }, organic] = await Promise.all([
        supabase.from('pages').select('*').eq('project_id', id!),
        fetchPagePerformance(id!, dateWindow(range)).catch(() => [] as GscPageRow[]),
      ])
      if (cancelled) return
      setHasOrganic(organic.length > 0)
      setMerged(mergePagesWithOrganic((crawledRows as Page[]) ?? [], organic))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, range])

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading pages…</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pages</h1>
          <p className="text-sm text-muted-foreground">
            Crawler findings joined with Search Console performance for {project.domain}.
          </p>
        </div>
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
      </div>

      {merged.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No pages yet"
          description="Run a Site Audit to crawl your pages, and sync Search Console to see how they perform in search."
        />
      ) : (
        <>
          {!hasOrganic && (
            <p className="text-xs text-muted-foreground">
              Showing crawler data only. Connect and sync Google Search Console to see clicks, impressions and
              positions for each page.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>Avg. Position</TableHead>
                <TableHead>Keywords</TableHead>
                <TableHead>Technical</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {merged.map((row) => {
                const issues = pageIssueCount(row.crawled)
                return (
                  <TableRow
                    key={row.urlNormalized}
                    className={row.crawled ? 'cursor-pointer' : undefined}
                    onClick={() => row.crawled && navigate(`/projects/${id}/pages/${row.crawled.id}`)}
                  >
                    <TableCell className="max-w-[320px] truncate text-accent">{row.url}</TableCell>
                    <TableCell>{row.organic ? formatNumber(row.organic.clicks) : '—'}</TableCell>
                    <TableCell>{row.organic ? formatNumber(row.organic.impressions) : '—'}</TableCell>
                    <TableCell>{row.organic ? `${(row.organic.ctr * 100).toFixed(2)}%` : '—'}</TableCell>
                    <TableCell>{row.organic?.position != null ? row.organic.position.toFixed(1) : '—'}</TableCell>
                    <TableCell>{row.organic ? formatNumber(row.organic.keyword_count) : '—'}</TableCell>
                    <TableCell>
                      {!row.crawled ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline">not crawled</Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Search Console reports traffic for this URL, but the crawler has not reached it.
                          </TooltipContent>
                        </Tooltip>
                      ) : issues === 0 ? (
                        <Badge variant="success">no issues</Badge>
                      ) : (
                        <Badge variant="warning">
                          {issues} issue{issues === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}
