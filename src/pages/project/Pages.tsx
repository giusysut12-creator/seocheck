import * as React from 'react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import type { Page, PageMetric } from '@/lib/database.types'
import { EmptyState } from '@/components/EmptyState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { FileText } from 'lucide-react'

type PageWithMetric = Page & { metric: PageMetric | null }

export default function Pages() {
  const { project, id } = useCurrentProject()
  const [pages, setPages] = React.useState<PageWithMetric[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selected, setSelected] = React.useState<PageWithMetric | null>(null)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: pageRows } = await supabase.from('pages').select('*').eq('project_id', id).order('word_count', { ascending: false })
      const list = (pageRows as Page[]) ?? []
      const { data: metricRows } = await supabase
        .from('page_metrics')
        .select('*')
        .in('page_id', list.map((p) => p.id))
        .order('date', { ascending: false })
      const latestByPage = new Map<string, PageMetric>()
      for (const m of (metricRows as PageMetric[]) ?? []) {
        if (!latestByPage.has(m.page_id)) latestByPage.set(m.page_id, m)
      }
      const merged = list
        .map((p) => ({ ...p, metric: latestByPage.get(p.id) ?? null }))
        .sort((a, b) => (b.metric?.organic_traffic ?? -1) - (a.metric?.organic_traffic ?? -1))
      if (!cancelled) setPages(merged)
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading pages…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pages</h1>
        <p className="text-sm text-muted-foreground">All URLs discovered by the last Site Audit crawl of {project.domain}.</p>
      </div>

      {pages.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No pages yet"
          description="Run a Site Audit from the Dashboard to crawl and list your pages here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Organic Traffic</TableHead>
              <TableHead>Keywords</TableHead>
              <TableHead>Top Keyword</TableHead>
              <TableHead>Avg. Position</TableHead>
              <TableHead>Traffic Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => setSelected(p)}>
                <TableCell className="max-w-[320px] truncate text-accent">{p.url}</TableCell>
                <TableCell>
                  <Badge variant={p.status_code === 200 ? 'success' : p.status_code && p.status_code >= 400 ? 'destructive' : 'outline'}>
                    {p.status_code ?? '—'}
                  </Badge>
                </TableCell>
                <TableCell>{formatNumber(p.metric?.organic_traffic ?? null)}</TableCell>
                <TableCell>{formatNumber(p.metric?.keywords_count ?? null)}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{p.metric?.top_keyword ?? '—'}</TableCell>
                <TableCell>{p.metric?.avg_position ?? '—'}</TableCell>
                <TableCell>{formatCurrency(p.metric?.traffic_value ?? null)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="break-all text-base">{selected.url}</DialogTitle>
                <DialogDescription>Crawled {selected.last_crawled_at ? new Date(selected.last_crawled_at).toLocaleString() : '—'}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Title" value={selected.title} />
                <Field label="H1" value={selected.h1} />
                <Field label="Meta Description" value={selected.meta_description} full />
                <Field label="Canonical" value={selected.canonical} full />
                <Field label="Status Code" value={String(selected.status_code ?? '—')} />
                <Field label="Robots Meta" value={selected.robots_meta ?? 'index, follow (default)'} />
                <Field label="Word Count" value={formatNumber(selected.word_count)} />
                <Field label="Load Time" value={selected.load_time_ms ? `${selected.load_time_ms} ms` : '—'} />
                <Field label="Internal Links" value={formatNumber(selected.internal_links_count)} />
                <Field label="External Links" value={formatNumber(selected.external_links_count)} />
                <Field label="Images Missing Alt" value={formatNumber(selected.images_missing_alt_count)} />
                <Field label="Orphan Page" value={selected.is_orphan ? 'Yes' : 'No'} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-foreground">{value || '—'}</p>
    </div>
  )
}
