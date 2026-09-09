import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Minus, Search, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useGoogleStatus } from '@/hooks/useGoogleStatus'
import {
  dateWindow,
  fetchKeywords,
  type GscKeywordRow,
  type KeywordSegment,
  type KeywordSort,
} from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import { enrichKeywords } from '@/lib/google/ads'
import { classifyKeyword, KIND_LABELS, type ClassifiedOpportunity } from '@/lib/seo/opportunityTypes'
import type { KeywordMetric } from '@/lib/database.types'
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import { EmptyState } from '@/components/EmptyState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'

const PAGE_SIZE = 50

const SEGMENTS: { value: KeywordSegment; label: string; hint: string }[] = [
  { value: 'all', label: 'All', hint: 'Every keyword with impressions in the period' },
  { value: 'top3', label: 'Top 3', hint: 'Average position 1-3' },
  { value: 'top10', label: 'Top 10', hint: 'Average position 1-10' },
  { value: 'page2', label: 'Page 2', hint: 'Average position 11-20' },
  { value: 'page3plus', label: 'Page 3+', hint: 'Average position 21 and beyond' },
]

const SORTS: { value: KeywordSort; label: string }[] = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr', label: 'CTR' },
  { value: 'position', label: 'Position' },
]

export default function Keywords() {
  const { project, id } = useCurrentProject()
  const { status } = useGoogleStatus(id)

  const [range, setRange] = React.useState<SyncRange>('28d')
  const [segment, setSegment] = React.useState<KeywordSegment>('all')
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [sort, setSort] = React.useState<KeywordSort>('clicks')
  const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc')
  const [page, setPage] = React.useState(0)

  const [rows, setRows] = React.useState<GscKeywordRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [adsMetrics, setAdsMetrics] = React.useState<Map<string, KeywordMetric>>(new Map())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [enriching, setEnriching] = React.useState(false)
  const [enrichMessage, setEnrichMessage] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const window = dateWindow(range)
        const { rows: fetched, total: count } = await fetchKeywords(id!, window, {
          search: debouncedSearch,
          segment,
          sort,
          direction,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        if (cancelled) return
        setRows(fetched)
        setTotal(count)

        // Google Ads enrichment, when it has been fetched for these keywords.
        // Absent rows simply render as "—": Ads volume is a different
        // measurement from Search Console impressions and is never inferred.
        if (fetched.length > 0) {
          const { data: keywordRows } = await supabase
            .from('keywords')
            .select('id, keyword, keyword_metrics(*)')
            .eq('project_id', id!)
            .in('keyword', fetched.map((r) => r.keyword))
          if (!cancelled) {
            const map = new Map<string, KeywordMetric>()
            for (const row of (keywordRows ?? []) as { keyword: string; keyword_metrics: KeywordMetric[] }[]) {
              const metric = row.keyword_metrics?.find((m) => m.source === 'google_ads')
              if (metric) map.set(row.keyword, metric)
            }
            setAdsMetrics(map)
          }
        } else if (!cancelled) {
          setAdsMetrics(new Map())
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load keywords')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, range, segment, debouncedSearch, sort, direction, page, reloadToken])

  if (!project) return null

  const hasData = total > 0 || rows.length > 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Keywords</h1>
        <p className="text-sm text-muted-foreground">
          Queries {project.domain} actually appeared for on Google, measured by Search Console.
        </p>
      </div>

      {!status?.connected || !status?.property ? (
        <>
          <EmptyState
            icon={<Search className="size-5" />}
            title="Connect Google Search Console"
            description="See your real organic keywords, clicks, impressions and rankings — measured by Google, not estimated."
          />
          <GoogleConnectionCard projectId={project.id} />
        </>
      ) : !hasData && !loading ? (
        <>
          <EmptyState
            title="No Search Console data yet"
            description="Run a synchronization to import your keyword performance for the selected period."
          />
          <GoogleConnectionCard projectId={project.id} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter keywords…"
                className="pl-9"
              />
            </div>
            <Select value={range} onValueChange={(v) => { setRange(v as SyncRange); setPage(0) }}>
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
            <Select value={sort} onValueChange={(v) => { setSort(v as KeywordSort); setPage(0) }}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    Sort: {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDirection(direction === 'desc' ? 'asc' : 'desc'); setPage(0) }}
            >
              {direction === 'desc' ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
              {direction === 'desc' ? 'Descending' : 'Ascending'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {SEGMENTS.map((s) => (
              <Tooltip key={s.value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setSegment(s.value); setPage(0) }}
                    className={cn(
                      'rounded-md border border-border px-3 py-1.5 text-sm transition-colors',
                      segment === s.value ? 'border-accent bg-accent/10 text-accent' : 'hover:bg-muted',
                    )}
                  >
                    {s.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{s.hint}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          {error ? (
            <EmptyState title="Could not load keywords" description={error} />
          ) : loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading keywords…</div>
          ) : rows.length === 0 ? (
            <EmptyState title="No keywords match" description="Try a different segment, period, or search term." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Clicks</TableHead>
                    <TableHead>Impressions</TableHead>
                    <TableHead>CTR</TableHead>
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
                          Avg. Position
                        </TooltipTrigger>
                        <TooltipContent>
                          Impression-weighted average position over the period — not a live absolute ranking.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead>Trend</TableHead>
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
                          Opportunity
                        </TooltipTrigger>
                        <TooltipContent>
                          What this keyword needs, and the clicks it would be worth. Blank means it is performing as
                          expected for its position.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">
                          Volume
                        </TooltipTrigger>
                        <TooltipContent>
                          Monthly searches from Google Ads — a different measurement from Search Console impressions.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead>CPC</TableHead>
                    <TableHead>Ranking Page</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const ads = adsMetrics.get(row.keyword)
                    return (
                      <TableRow key={row.keyword}>
                        <TableCell className="max-w-[240px] truncate font-medium text-foreground">{row.keyword}</TableCell>
                        <TableCell>{formatNumber(row.clicks)}</TableCell>
                        <TableCell>{formatNumber(row.impressions)}</TableCell>
                        <TableCell>{(row.ctr * 100).toFixed(2)}%</TableCell>
                        <TableCell>{row.position !== null ? row.position.toFixed(1) : '—'}</TableCell>
                        <TableCell>
                          <PositionTrend change={row.position_change} />
                        </TableCell>
                        <TableCell>
                          <OpportunityCell row={row} />
                        </TableCell>
                        <TableCell>{ads?.search_volume != null ? formatNumber(ads.search_volume) : '—'}</TableCell>
                        <TableCell>{ads?.cpc != null ? formatCurrency(ads.cpc) : '—'}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                          {row.top_page ?? '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {formatNumber(total)} keyword{total === 1 ? '' : 's'} · page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="size-4" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              {status.adsConfigured ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enriching}
                    onClick={async () => {
                      setEnriching(true)
                      setEnrichMessage(null)
                      try {
                        const result = await enrichKeywords(project.id, rows.map((r) => r.keyword))
                        setEnrichMessage(
                          result.enriched > 0
                            ? `Enriched ${result.enriched} keyword${result.enriched === 1 ? '' : 's'} with Google Ads data.`
                            : 'All these keywords already have recent Google Ads data.',
                        )
                        setReloadToken((t) => t + 1)
                      } catch (err) {
                        setEnrichMessage(err instanceof Error ? err.message : 'Enrichment failed')
                      } finally {
                        setEnriching(false)
                      }
                    }}
                  >
                    {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Enrich with Google Ads
                  </Button>
                  {enrichMessage && <span className="text-xs text-muted-foreground">{enrichMessage}</span>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Connect Google Ads to enrich these keywords with search volume and CPC.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The most valuable opportunity for this keyword, if any. Turns a row of
 * numbers into the reason it is worth attention.
 */
function OpportunityCell({ row }: { row: GscKeywordRow }) {
  const best: ClassifiedOpportunity | undefined = classifyKeyword({
    keyword: row.keyword,
    position: row.position,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    previousPosition: row.previous_position,
    previousClicks: row.previous_clicks,
    topPage: row.top_page,
  }).sort((a, b) => b.score - a.score)[0]

  if (!best) return <span className="text-xs text-muted-foreground">—</span>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex cursor-help items-center gap-1.5">
          <Badge variant="accent">{KIND_LABELS[best.kind].label}</Badge>
          <span className="text-xs text-muted-foreground">+{formatNumber(best.potentialClicks)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{best.headline}</TooltipContent>
    </Tooltip>
  )
}

/** A positive change means the keyword moved toward position 1. */
function PositionTrend({ change }: { change: number | null }) {
  if (change === null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" /> new
      </span>
    )
  }
  if (Math.abs(change) < 0.1) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" /> stable
      </span>
    )
  }
  const improved = change > 0
  return (
    <Badge variant={improved ? 'success' : 'destructive'}>
      {improved ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(change).toFixed(1)}
    </Badge>
  )
}
