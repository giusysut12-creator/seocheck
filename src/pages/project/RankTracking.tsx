import * as React from 'react'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { checkProviderConfigured, seoProvider } from '@/lib/seo/seoApiProvider'
import type { Keyword, KeywordRanking } from '@/lib/database.types'
import { ProviderNotConfigured } from '@/components/ProviderNotConfigured'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

type KeywordWithRanking = Keyword & { latest: KeywordRanking | null }

export default function RankTracking() {
  const { project, id } = useCurrentProject()
  const [keywords, setKeywords] = React.useState<KeywordWithRanking[]>([])
  const [history, setHistory] = React.useState<KeywordRanking[]>([])
  const [loading, setLoading] = React.useState(true)
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [newKeywords, setNewKeywords] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const loadKeywords = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: kwRows } = await supabase
      .from('keywords')
      .select('*')
      .eq('project_id', id)
      .eq('is_tracked', true)
      .order('created_at', { ascending: false })
    const list = (kwRows as Keyword[]) ?? []
    const { data: rankingRows } = await supabase
      .from('keyword_rankings')
      .select('*')
      .in('keyword_id', list.map((k) => k.id))
      .order('date', { ascending: false })
    const allRankings = (rankingRows as KeywordRanking[]) ?? []
    const latestByKeyword = new Map<string, KeywordRanking>()
    for (const r of allRankings) if (!latestByKeyword.has(r.keyword_id)) latestByKeyword.set(r.keyword_id, r)
    setKeywords(list.map((k) => ({ ...k, latest: latestByKeyword.get(k.id) ?? null })))
    setHistory(allRankings)
    setLoading(false)
  }, [id])

  React.useEffect(() => {
    loadKeywords()
  }, [loadKeywords])

  React.useEffect(() => {
    checkProviderConfigured().then(setConfigured)
  }, [])

  async function handleAddKeywords() {
    if (!id) return
    const list = Array.from(new Set(newKeywords.split('\n').map((k) => k.trim()).filter(Boolean)))
    if (list.length === 0) return
    setError(null)
    const { error: insertError } = await supabase.from('keywords').insert(
      list.map((keyword) => ({
        project_id: id,
        keyword,
        country: project?.country ?? 'US',
        device: project?.device ?? 'desktop',
        is_tracked: true,
        source: 'manual' as const,
      })),
    )
    if (insertError && !insertError.message.includes('duplicate')) setError(insertError.message)
    setNewKeywords('')
    setAddOpen(false)
    loadKeywords()
  }

  async function handleRefresh() {
    if (!project || keywords.length === 0) return
    setRefreshing(true)
    setError(null)
    try {
      const results = await seoProvider.getKeywordRankings(
        project.domain,
        keywords.map((k) => k.keyword),
        { country: project.country, device: project.device },
      )
      const byKeyword = new Map(results.map((r) => [r.keyword, r]))
      for (const kw of keywords) {
        const result = byKeyword.get(kw.keyword)
        if (!result) continue
        const bestPrevious = kw.latest?.best_position ?? null
        const best = bestPrevious && result.position ? Math.min(bestPrevious, result.position) : (result.position ?? bestPrevious)
        await supabase.from('keyword_rankings').upsert(
          {
            keyword_id: kw.id,
            date: new Date().toISOString().slice(0, 10),
            position: result.position,
            previous_position: kw.latest?.position ?? null,
            best_position: best,
            url: result.url,
            serp_features: result.serpFeatures,
          },
          { onConflict: 'keyword_id,date' },
        )
      }
      await loadKeywords()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh rankings')
    } finally {
      setRefreshing(false)
    }
  }

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading rank tracking…</div>

  const dates = Array.from(new Set(history.map((h) => h.date))).sort()
  const chartData = dates.map((date) => {
    const dayRows = history.filter((h) => h.date === date && h.position !== null)
    const avg = dayRows.length ? dayRows.reduce((sum, r) => sum + (r.position ?? 0), 0) / dayRows.length : null
    return { date, avgPosition: avg !== null ? Math.round(avg * 10) / 10 : null }
  })

  const latestPositions = keywords.map((k) => k.latest?.position ?? null).filter((p): p is number => p !== null)
  const top3 = latestPositions.filter((p) => p <= 3).length
  const top10 = latestPositions.filter((p) => p <= 10).length
  const top20 = latestPositions.filter((p) => p <= 20).length
  const top100 = latestPositions.filter((p) => p <= 100).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Rank Tracking</h1>
          <p className="text-sm text-muted-foreground">Track keyword positions over time for {project.domain}.</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="size-4" /> Add keywords
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add keywords to track</DialogTitle>
              </DialogHeader>
              <Textarea
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder={'One keyword per line, e.g.\nseo tool\nseo audit\nkeyword research'}
                rows={6}
              />
              <DialogFooter>
                <Button variant="accent" onClick={handleAddKeywords}>
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="accent" onClick={handleRefresh} disabled={refreshing || keywords.length === 0}>
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh rankings
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {configured === false && <ProviderNotConfigured feature="live keyword position tracking" />}

      {keywords.length === 0 ? (
        <EmptyState title="No tracked keywords yet" description="Add keywords above to start tracking their ranking position over time." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatBox label="Top 3" value={top3} />
            <StatBox label="Top 10" value={top10} />
            <StatBox label="Top 20" value={top20} />
            <StatBox label="Top 100" value={top100} />
          </div>

          {chartData.length > 1 && (
            <Card>
              <CardContent className="h-64 p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Average position over time (lower is better)</p>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 11 }} />
                    <YAxis reversed tick={{ fontSize: 11 }} />
                    <ChartTooltip labelFormatter={(d) => formatDate(d as string)} contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="avgPosition" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Keyword</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Best</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>SERP Features</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.map((k) => {
                const pos = k.latest?.position ?? null
                const prev = k.latest?.previous_position ?? null
                const delta = pos !== null && prev !== null ? prev - pos : null
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-foreground">{k.keyword}</TableCell>
                    <TableCell>{pos ?? '—'}</TableCell>
                    <TableCell>
                      {delta === null ? (
                        <Minus className="size-3.5 text-muted-foreground" />
                      ) : delta > 0 ? (
                        <span className="flex items-center gap-1 text-success">
                          <ArrowUp className="size-3.5" /> {delta}
                        </span>
                      ) : delta < 0 ? (
                        <span className="flex items-center gap-1 text-destructive">
                          <ArrowDown className="size-3.5" /> {Math.abs(delta)}
                        </span>
                      ) : (
                        <Minus className="size-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>{k.latest?.best_position ?? '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{k.latest?.url ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(k.latest?.serp_features ?? []).map((f) => (
                          <Badge key={f} variant="outline">
                            {f}
                          </Badge>
                        ))}
                      </div>
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

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
