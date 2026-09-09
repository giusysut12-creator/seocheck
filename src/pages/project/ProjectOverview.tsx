import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, ScanSearch, XCircle } from 'lucide-react'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useLatestAudit } from '@/hooks/useLatestAudit'
import { useDomainMetrics, percentChange } from '@/hooks/useDomainMetrics'
import { startCrawl } from '@/lib/edgeFunctions'
import { LAST_PROJECT_KEY } from '@/pages/Dashboard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/EmptyState'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { OrganicPerformance } from '@/components/google/OrganicPerformance'
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import { SeoScoreGauge } from '@/components/dashboard/SeoScoreGauge'
import { formatCurrency, formatNumber } from '@/lib/utils'

export default function ProjectOverview() {
  const { project, id } = useCurrentProject()
  const { audit, refresh } = useLatestAudit(id)
  const { domain, history, latestProvider, previousProvider } = useDomainMetrics(id)
  const navigate = useNavigate()
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [gscVersion, setGscVersion] = React.useState(0)

  React.useEffect(() => {
    if (project) localStorage.setItem(LAST_PROJECT_KEY, project.id)
  }, [project])

  if (!project) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading project…</div>
  }

  const isCrawling = audit?.status === 'crawling' || audit?.status === 'pending'

  async function handleRunAudit() {
    setError(null)
    setRunning(true)
    const { error: crawlError } = await startCrawl(project!.id)
    setRunning(false)
    if (crawlError) setError(crawlError)
    refresh()
  }

  const scoreSparkline = history.filter((h) => h.seo_score !== null).map((h) => h.seo_score as number)
  const trafficSparkline = history.filter((h) => h.organic_traffic !== null).map((h) => h.organic_traffic as number)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project.domain}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{project.country}</Badge>
            <Badge variant="outline" className="capitalize">
              {project.device}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {project.search_engine}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button variant="accent" onClick={handleRunAudit} disabled={running || isCrawling}>
            {running || isCrawling ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
            {isCrawling ? 'Crawling…' : 'Run Site Audit'}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      {isCrawling && audit && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Crawling {project.domain}…</span>
              <span>
                {audit.urls_crawled} / {audit.urls_total || '…'} URLs
              </span>
            </div>
            <Progress value={audit.urls_total ? (audit.urls_crawled / audit.urls_total) * 100 : 5} />
          </CardContent>
        </Card>
      )}

      {!audit && !isCrawling && (
        <EmptyState
          icon={<ScanSearch className="size-5" />}
          title="Run your first Site Audit"
          description="Crawl your website to get an SEO Health Score, technical issues, and on-page recommendations."
          action={
            <Button variant="accent" onClick={handleRunAudit} disabled={running}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              Run Site Audit
            </Button>
          }
        />
      )}

      {audit?.status === 'failed' && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="size-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Audit failed</p>
              <p className="text-xs text-muted-foreground">{audit.error_message ?? 'The domain could not be reached.'}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <OrganicPerformance projectId={project.id} key={`gsc-${gscVersion}`} />

      <GoogleConnectionCard projectId={project.id} onSynced={() => setGscVersion((v) => v + 1)} />

      {audit && audit.status === 'completed' && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard
              label="SEO Score"
              value={audit.seo_score ?? '—'}
              suffix="/100"
              sparkline={scoreSparkline}
              tooltip="Weighted score across Technical, On-page, Performance, Indexability, Content and Backlinks."
            />
            <MetricCard
              label="Organic Traffic"
              value={formatNumber(latestProvider?.organic_traffic ?? null)}
              change={percentChange(latestProvider?.organic_traffic ?? null, previousProvider?.organic_traffic ?? null)}
              sparkline={trafficSparkline}
              tooltip="Estimated monthly organic search visits, from your connected SEO data provider."
            />
            <MetricCard
              label="Organic Keywords"
              value={formatNumber(latestProvider?.organic_keywords ?? null)}
              change={percentChange(latestProvider?.organic_keywords ?? null, previousProvider?.organic_keywords ?? null)}
              tooltip="Number of keywords this domain ranks for in the top 100 organic results."
            />
            <MetricCard
              label="Est. Traffic Value"
              value={formatCurrency(latestProvider?.traffic_value ?? null)}
              change={percentChange(latestProvider?.traffic_value ?? null, previousProvider?.traffic_value ?? null)}
              tooltip="Estimated monthly value of organic traffic if it had to be paid for via ads."
            />
            <MetricCard
              label="Backlinks"
              value={formatNumber(latestProvider?.backlinks ?? null)}
              change={percentChange(latestProvider?.backlinks ?? null, previousProvider?.backlinks ?? null)}
              tooltip="Total number of backlinks pointing to this domain."
            />
            <MetricCard
              label="Referring Domains"
              value={formatNumber(latestProvider?.referring_domains ?? null)}
              change={percentChange(latestProvider?.referring_domains ?? null, previousProvider?.referring_domains ?? null)}
              tooltip="Number of unique domains linking to this site."
            />
            <MetricCard label="Domain Authority" value={latestProvider?.domain_authority ?? '—'} tooltip="Provider-estimated authority score, 0-100." />
            <MetricCard
              label="Pages Crawled"
              value={formatNumber(audit.urls_crawled)}
              tooltip="URLs analyzed by the last Site Audit crawl."
            />
          </div>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">SEO Health Score</h2>
              <SeoScoreGauge
                score={audit.seo_score ?? 0}
                categories={{
                  technical_score: audit.technical_score,
                  onpage_score: audit.onpage_score,
                  performance_score: audit.performance_score,
                  indexability_score: audit.indexability_score,
                  content_score: audit.content_score,
                  backlinks_score: audit.backlinks_score,
                }}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <button onClick={() => navigate(`/projects/${id}/audit?priority=critical`)} className="text-left">
              <Card className="transition-colors hover:border-destructive/50">
                <CardContent className="flex items-center gap-3 p-4">
                  <XCircle className="size-6 text-destructive" />
                  <div>
                    <p className="text-2xl font-semibold text-foreground">{audit.critical_count}</p>
                    <p className="text-xs text-muted-foreground">Critical issues</p>
                  </div>
                </CardContent>
              </Card>
            </button>
            <button onClick={() => navigate(`/projects/${id}/audit?priority=high,medium,low`)} className="text-left">
              <Card className="transition-colors hover:border-warning/50">
                <CardContent className="flex items-center gap-3 p-4">
                  <AlertTriangle className="size-6 text-warning" />
                  <div>
                    <p className="text-2xl font-semibold text-foreground">{audit.warning_count}</p>
                    <p className="text-xs text-muted-foreground">Warnings</p>
                  </div>
                </CardContent>
              </Card>
            </button>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="size-6 text-success" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">{audit.passed_count}</p>
                  <p className="text-xs text-muted-foreground">Checks passed</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {domain && <p className="text-xs text-muted-foreground">Tracking domain: {domain.domain}</p>}
    </div>
  )
}
