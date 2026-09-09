import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  dateWindow,
  fetchPageKeywords,
  fetchPagePerformance,
  type GscPageKeywordRow,
  type GscPageRow,
} from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import type { Page } from '@/lib/database.types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { formatNumber } from '@/lib/utils'

export default function PageDetail() {
  const { id, pageId } = useParams<{ id: string; pageId: string }>()
  const [page, setPage] = React.useState<Page | null>(null)
  const [organic, setOrganic] = React.useState<GscPageRow | null>(null)
  const [keywords, setKeywords] = React.useState<GscPageKeywordRow[]>([])
  const [range, setRange] = React.useState<SyncRange>('28d')
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id || !pageId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('pages').select('*').eq('id', pageId!).maybeSingle()
      const crawled = (data as Page) ?? null
      if (cancelled) return
      setPage(crawled)

      if (crawled?.url_normalized) {
        const window = dateWindow(range)
        const [pages, pageKeywords] = await Promise.all([
          fetchPagePerformance(id!, window).catch(() => [] as GscPageRow[]),
          fetchPageKeywords(id!, crawled.url_normalized, window).catch(() => [] as GscPageKeywordRow[]),
        ])
        if (cancelled) return
        setOrganic(pages.find((p) => p.page_normalized === crawled.url_normalized) ?? null)
        setKeywords(pageKeywords)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, pageId, range])

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading page…</div>
  if (!page) return <EmptyState title="Page not found" description="This page is no longer in the project." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2">
            <Link to={`/projects/${id}/pages`}>
              <ArrowLeft className="size-4" /> All pages
            </Link>
          </Button>
          <h1 className="break-all text-lg font-semibold">{page.url}</h1>
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Open page <ExternalLink className="size-3" />
          </a>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Organic performance</CardTitle>
            <CardDescription>Source: Google Search Console</CardDescription>
          </CardHeader>
          <CardContent>
            {organic ? (
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Clicks" value={formatNumber(organic.clicks)} />
                <Stat label="Impressions" value={formatNumber(organic.impressions)} />
                <Stat label="CTR" value={`${(organic.ctr * 100).toFixed(2)}%`} />
                <Stat
                  label="Average position"
                  value={organic.position != null ? organic.position.toFixed(1) : '—'}
                />
                <Stat label="Ranking keywords" value={formatNumber(organic.keyword_count)} />
                <Stat label="Top keyword" value={organic.top_keyword ?? '—'} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Search Console data for this URL in the selected period.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">On-page &amp; technical</CardTitle>
            <CardDescription>Source: Site Audit crawler</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Title" value={page.title} check={Boolean(page.title)} />
            <Field label="Meta description" value={page.meta_description} check={Boolean(page.meta_description)} />
            <Field label="H1" value={page.h1} check={page.h1_count === 1} />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Stat label="Word count" value={formatNumber(page.word_count)} />
              <Stat label="Internal links" value={formatNumber(page.internal_links_count)} />
              <Stat label="Images without alt" value={formatNumber(page.images_missing_alt_count)} />
              <Stat label="Status code" value={String(page.status_code ?? '—')} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Keywords ranking with this page</CardTitle>
          <CardDescription>Source: Google Search Console</CardDescription>
        </CardHeader>
        <CardContent>
          {keywords.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keywords recorded for this page in the selected period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Clicks</TableHead>
                  <TableHead>Impressions</TableHead>
                  <TableHead>CTR</TableHead>
                  <TableHead>Avg. Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.slice(0, 100).map((k) => (
                  <TableRow key={k.keyword}>
                    <TableCell className="max-w-[280px] truncate font-medium text-foreground">{k.keyword}</TableCell>
                    <TableCell>{formatNumber(k.clicks)}</TableCell>
                    <TableCell>{formatNumber(k.impressions)}</TableCell>
                    <TableCell>{(k.ctr * 100).toFixed(2)}%</TableCell>
                    <TableCell>{k.position != null ? k.position.toFixed(1) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}

function Field({ label, value, check }: { label: string; value: string | null; check: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <Badge variant={check ? 'success' : 'warning'}>{check ? 'OK' : 'needs attention'}</Badge>
      </div>
      <p className="mt-0.5 break-words text-foreground">{value || '—'}</p>
    </div>
  )
}
