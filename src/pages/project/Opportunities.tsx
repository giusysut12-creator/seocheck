import * as React from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useGoogleStatus } from '@/hooks/useGoogleStatus'
import { dateWindow, fetchKeywords, type GscKeywordRow } from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import {
  computeOpportunityScore,
  explainOpportunity,
  isQuickWin,
  recommendActions,
  type CrawledPageFacts,
  type OpportunityResult,
} from '@/lib/seo/opportunityEngine'
import type { KeywordMetric, Page, SeoOpportunity } from '@/lib/database.types'
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatNumber } from '@/lib/utils'

const IMPACT_VARIANT: Record<string, 'destructive' | 'warning' | 'default'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'default',
}

interface KeywordOpportunity {
  row: GscKeywordRow
  result: OpportunityResult
  page: Page | null
  ads: KeywordMetric | null
  actions: string[]
  reason: string
}

export default function Opportunities() {
  const { project, id } = useCurrentProject()
  const { status } = useGoogleStatus(id)
  const [range, setRange] = React.useState<SyncRange>('28d')
  const [keywordOpportunities, setKeywordOpportunities] = React.useState<KeywordOpportunity[]>([])
  const [technical, setTechnical] = React.useState<SeoOpportunity[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      setLoading(true)

      // Crawler-derived opportunities are written by the Site Audit and need
      // no external data.
      const { data: stored } = await supabase
        .from('seo_opportunities')
        .select('*')
        .eq('project_id', id!)
        .eq('status', 'open')
        .order('opportunity_score', { ascending: false })
      if (!cancelled) setTechnical((stored as SeoOpportunity[]) ?? [])

      // Keyword opportunities need Search Console; without it this section
      // simply stays empty rather than being invented.
      let keywords: GscKeywordRow[] = []
      try {
        const result = await fetchKeywords(id!, dateWindow(range), {
          sort: 'impressions',
          direction: 'desc',
          limit: 200,
        })
        keywords = result.rows
      } catch {
        keywords = []
      }
      if (cancelled) return

      const candidates = keywords.filter((row) =>
        isQuickWin({
          keyword: row.keyword,
          position: row.position,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr,
        }),
      )

      // Pull the crawler's findings for the pages these keywords rank with,
      // so recommendations cite measured on-page facts.
      const pageUrls = Array.from(new Set(candidates.map((c) => c.top_page).filter(Boolean))) as string[]
      const { data: pageRows } = pageUrls.length
        ? await supabase.from('pages').select('*').eq('project_id', id!).in('url', pageUrls)
        : { data: [] }
      const pagesByUrl = new Map(((pageRows as Page[]) ?? []).map((p) => [p.url, p]))

      const { data: keywordRows } = candidates.length
        ? await supabase
            .from('keywords')
            .select('keyword, keyword_metrics(*)')
            .eq('project_id', id!)
            .in('keyword', candidates.map((c) => c.keyword))
        : { data: [] }
      const adsByKeyword = new Map<string, KeywordMetric>()
      for (const row of (keywordRows ?? []) as { keyword: string; keyword_metrics: KeywordMetric[] }[]) {
        const metric = row.keyword_metrics?.find((m) => m.source === 'google_ads')
        if (metric) adsByKeyword.set(row.keyword, metric)
      }

      const built = candidates
        .map((row) => {
          const page = row.top_page ? pagesByUrl.get(row.top_page) ?? null : null
          const ads = adsByKeyword.get(row.keyword) ?? null
          const input = {
            keyword: row.keyword,
            position: row.position,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            searchVolume: ads?.search_volume ?? null,
          }
          const facts: CrawledPageFacts | null = page
            ? {
                title: page.title,
                h1: page.h1,
                metaDescription: page.meta_description,
                wordCount: page.word_count,
                internalLinksCount: page.internal_links_count,
                imagesMissingAlt: page.images_missing_alt_count,
              }
            : null
          const result = computeOpportunityScore(input)
          return {
            row,
            result,
            page,
            ads,
            actions: recommendActions(input, facts),
            reason: explainOpportunity(input, result),
          }
        })
        .sort((a, b) => b.result.score - a.result.score)

      if (!cancelled) {
        setKeywordOpportunities(built)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SEO Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by measured demand and how realistically {project.domain} can climb.
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

      <Tabs defaultValue="quick_wins">
        <TabsList className="flex-wrap">
          <TabsTrigger value="quick_wins">Quick Wins ({keywordOpportunities.length})</TabsTrigger>
          <TabsTrigger value="technical">Technical &amp; Content ({technical.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="quick_wins" className="space-y-3">
          {!connected ? (
            <>
              <EmptyState
                icon={<TrendingUp className="size-5" />}
                title="Connect Google Search Console"
                description="Keyword opportunities are built from the queries your site already earns impressions for."
              />
              <GoogleConnectionCard projectId={project.id} />
            </>
          ) : keywordOpportunities.length === 0 ? (
            <EmptyState
              title="No quick wins in this period"
              description="Quick wins are keywords ranking between positions 4 and 20 with at least 100 impressions. Try a longer period."
            />
          ) : (
            keywordOpportunities.map(({ row, result, page, ads, actions, reason }) => (
              <Card key={row.keyword}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{row.keyword}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{reason}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={IMPACT_VARIANT[result.impact]}>{result.impact.toUpperCase()}</Badge>
                      <Badge variant="outline">Score {result.score}</Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <Metric label="Position" value={row.position?.toFixed(1) ?? '—'} source="Search Console" />
                    <Metric label="Impressions" value={formatNumber(row.impressions)} source="Search Console" />
                    <Metric label="Clicks" value={formatNumber(row.clicks)} source="Search Console" />
                    <Metric label="CTR" value={`${(row.ctr * 100).toFixed(2)}%`} source="Search Console" />
                    <Metric
                      label="Potential clicks"
                      value={`+${formatNumber(result.potentialClicks)}`}
                      source="modelled"
                    />
                    {ads?.search_volume != null && (
                      <Metric label="Volume" value={formatNumber(ads.search_volume)} source="Google Ads" />
                    )}
                    {ads?.cpc != null && <Metric label="CPC" value={formatCurrency(ads.cpc)} source="Google Ads" />}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Recommended actions
                    </p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-foreground">
                      {actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                    {page ? (
                      <Link
                        to={`/projects/${id}/pages/${page.id}`}
                        className="mt-2 inline-block text-xs text-accent hover:underline"
                      >
                        Open page analysis →
                      </Link>
                    ) : row.top_page ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Ranking page not crawled yet — run a Site Audit for on-page recommendations.
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="technical" className="space-y-3">
          {technical.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="No technical opportunities"
              description="Run a Site Audit to surface technical, internal-linking and content opportunities from the crawl."
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
                    <div className="flex shrink-0 items-center gap-2">
                      {o.potential_impact && (
                        <Badge variant={IMPACT_VARIANT[o.potential_impact]}>{o.potential_impact.toUpperCase()}</Badge>
                      )}
                      <Badge variant="outline">Score {o.opportunity_score}</Badge>
                    </div>
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
    </div>
  )
}

function Metric({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <span title={`Source: ${source}`}>
      {label}: <span className="font-medium text-foreground">{value}</span>
    </span>
  )
}
