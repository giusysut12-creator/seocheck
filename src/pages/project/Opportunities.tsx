import * as React from 'react'
import { Link } from 'react-router-dom'
import { MousePointerClick, Sparkles, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useGoogleStatus } from '@/hooks/useGoogleStatus'
import { dateWindow, fetchCannibalization, fetchKeywords, type GscKeywordRow } from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import {
  classifyCannibalization,
  KIND_LABELS,
  rankOpportunities,
  type ClassifiedOpportunity,
  type OpportunityKind,
} from '@/lib/seo/opportunityTypes'
import type { Page, SeoOpportunity } from '@/lib/database.types'
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatNumber } from '@/lib/utils'

const KIND_ORDER: OpportunityKind[] = ['ctr_gap', 'striking_distance', 'losing_ground', 'cannibalization']

const KIND_STYLE: Record<OpportunityKind, string> = {
  ctr_gap: 'text-success',
  striking_distance: 'text-accent',
  losing_ground: 'text-destructive',
  cannibalization: 'text-warning',
}

export default function Opportunities() {
  const { project, id } = useCurrentProject()
  const { status } = useGoogleStatus(id)
  const [range, setRange] = React.useState<SyncRange>('28d')
  const [opportunities, setOpportunities] = React.useState<ClassifiedOpportunity[]>([])
  const [technical, setTechnical] = React.useState<SeoOpportunity[]>([])
  const [pagesByUrl, setPagesByUrl] = React.useState<Map<string, Page>>(new Map())
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      setLoading(true)

      const { data: stored } = await supabase
        .from('seo_opportunities')
        .select('*')
        .eq('project_id', id!)
        .eq('status', 'open')
        .order('opportunity_score', { ascending: false })
      if (!cancelled) setTechnical((stored as SeoOpportunity[]) ?? [])

      const window = dateWindow(range)
      const [keywordResult, cannibalized] = await Promise.all([
        fetchKeywords(id!, window, { sort: 'impressions', direction: 'desc', limit: 500 }).catch(() => ({
          rows: [] as GscKeywordRow[],
          total: 0,
        })),
        fetchCannibalization(id!, window).catch(() => []),
      ])
      if (cancelled) return

      const fromKeywords = rankOpportunities(
        keywordResult.rows.map((row) => ({
          keyword: row.keyword,
          position: row.position,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr,
          previousPosition: row.previous_position,
          previousClicks: row.previous_clicks,
          topPage: row.top_page,
        })),
      )

      const fromCannibalization = cannibalized
        .map((row) =>
          classifyCannibalization({
            keyword: row.keyword,
            totalImpressions: row.total_impressions,
            pages: row.pages,
          }),
        )
        .filter((o): o is ClassifiedOpportunity => o !== null)

      const all = [...fromKeywords, ...fromCannibalization].sort((a, b) => b.score - a.score)

      // Link each opportunity to the crawled page, so the user can jump
      // straight to what the audit found on it.
      const urls = Array.from(new Set(all.map((o) => o.page).filter(Boolean))) as string[]
      const { data: pageRows } = urls.length
        ? await supabase.from('pages').select('*').eq('project_id', id!).in('url', urls)
        : { data: [] }

      if (!cancelled) {
        setPagesByUrl(new Map(((pageRows as Page[]) ?? []).map((p) => [p.url, p])))
        setOpportunities(all)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id, range])

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading opportunities…</div>

  const connected = status?.connected && status?.property
  const byKind = (kind: OpportunityKind) => opportunities.filter((o) => o.kind === kind)
  const totalPotential = opportunities.reduce((sum, o) => sum + o.potentialClicks, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SEO Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            What to work on next for {project.domain}, ordered by the traffic at stake and how quickly it can be won.
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

      {!connected ? (
        <>
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="Connect Google Search Console"
            description="Opportunities are built from the queries your site already earns impressions for."
          />
          <GoogleConnectionCard projectId={project.id} />
        </>
      ) : (
        <>
          {opportunities.length > 0 && (
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="flex items-center gap-3 p-4">
                <MousePointerClick className="size-5 shrink-0 text-accent" />
                <p className="text-sm text-foreground">
                  Acting on everything below is worth roughly{' '}
                  <strong className="font-semibold">{formatNumber(totalPotential)} more clicks</strong> at today's search
                  demand — an estimate from your measured impressions and position, not a promise.
                </p>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="all">
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">Priority ({opportunities.length})</TabsTrigger>
              {KIND_ORDER.map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  {KIND_LABELS[kind].label} ({byKind(kind).length})
                </TabsTrigger>
              ))}
              <TabsTrigger value="technical">Technical ({technical.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              <OpportunityList items={opportunities} projectId={project.id} pagesByUrl={pagesByUrl} showKind />
            </TabsContent>

            {KIND_ORDER.map((kind) => (
              <TabsContent key={kind} value={kind} className="space-y-3">
                <p className="text-sm text-muted-foreground">{KIND_LABELS[kind].blurb}</p>
                <OpportunityList items={byKind(kind)} projectId={project.id} pagesByUrl={pagesByUrl} />
              </TabsContent>
            ))}

            <TabsContent value="technical" className="space-y-3">
              {technical.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="size-5" />}
                  title="No technical opportunities"
                  description="Run a Site Audit to surface technical, internal-linking and content findings from the crawl."
                />
              ) : (
                technical.map((o) => (
                  <Card key={o.id}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{o.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{o.description}</p>
                        </div>
                        <Badge variant="outline">Score {o.opportunity_score}</Badge>
                      </div>
                      {o.recommended_actions.length > 0 && (
                        <ul className="list-inside list-disc space-y-0.5 text-xs text-foreground">
                          {o.recommended_actions.map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-muted-foreground">Source: Site Audit crawler</p>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

function OpportunityList({
  items,
  projectId,
  pagesByUrl,
  showKind = false,
}: {
  items: ClassifiedOpportunity[]
  projectId: string
  pagesByUrl: Map<string, Page>
  showKind?: boolean
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing here right now"
        description="No keyword in the selected period matches this pattern. Try a longer period."
      />
    )
  }

  return (
    <div className="space-y-3">
      {items.map((o) => {
        const page = o.page ? pagesByUrl.get(o.page) : undefined
        return (
          <Card key={`${o.kind}-${o.keyword}`}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{o.keyword}</p>
                    {showKind && (
                      <Badge variant="outline" className={cn(KIND_STYLE[o.kind])}>
                        {KIND_LABELS[o.kind].label}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{o.headline}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold text-foreground">+{formatNumber(o.potentialClicks)}</p>
                  <p className="text-xs text-muted-foreground">clicks at stake</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to do</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-foreground">
                  {o.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>

              {page ? (
                <Link
                  to={`/projects/${projectId}/pages/${page.id}`}
                  className="inline-block text-xs text-accent hover:underline"
                >
                  Open page analysis →
                </Link>
              ) : o.page ? (
                <p className="truncate text-xs text-muted-foreground">
                  {o.page} · not crawled yet — run a Site Audit for on-page detail
                </p>
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
