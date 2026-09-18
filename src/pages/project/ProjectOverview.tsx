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
    return <div className="py-16 text-center text-sm text-muted-foreground">Caricamento progetto…</div>
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
            {isCrawling ? 'Scansione in corso…' : 'Avvia controllo del sito'}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      {isCrawling && audit && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Scansione di {project.domain}…</span>
              <span>
                {audit.urls_crawled} / {audit.urls_total || '…'} URL
              </span>
            </div>
            <Progress value={audit.urls_total ? (audit.urls_crawled / audit.urls_total) * 100 : 5} />
          </CardContent>
        </Card>
      )}

      {!audit && !isCrawling && (
        <EmptyState
          icon={<ScanSearch className="size-5" />}
          title="Avvia il tuo primo controllo del sito"
          description="Scansiona il tuo sito web per ottenere un punteggio di salute SEO, problemi tecnici e consigli on-page."
          action={
            <Button variant="accent" onClick={handleRunAudit} disabled={running}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              Avvia controllo del sito
            </Button>
          }
        />
      )}

      {audit?.status === 'failed' && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="size-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Controllo non riuscito</p>
              <p className="text-xs text-muted-foreground">{audit.error_message ?? 'Non è stato possibile raggiungere il dominio.'}</p>
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
              label="Punteggio SEO"
              value={audit.seo_score ?? '—'}
              suffix="/100"
              sparkline={scoreSparkline}
              tooltip="Punteggio ponderato su Tecnica, On-page, Performance, Indicizzabilità, Contenuti e Backlink."
            />
            <MetricCard
              label="Traffico organico"
              value={formatNumber(latestProvider?.organic_traffic ?? null)}
              change={percentChange(latestProvider?.organic_traffic ?? null, previousProvider?.organic_traffic ?? null)}
              sparkline={trafficSparkline}
              tooltip="Visite di ricerca organica mensili stimate, dal tuo provider dati SEO connesso."
            />
            <MetricCard
              label="Parole chiave organiche"
              value={formatNumber(latestProvider?.organic_keywords ?? null)}
              change={percentChange(latestProvider?.organic_keywords ?? null, previousProvider?.organic_keywords ?? null)}
              tooltip="Numero di parole chiave per cui questo dominio si posiziona nei primi 100 risultati organici."
            />
            <MetricCard
              label="Valore traffico stimato"
              value={formatCurrency(latestProvider?.traffic_value ?? null)}
              change={percentChange(latestProvider?.traffic_value ?? null, previousProvider?.traffic_value ?? null)}
              tooltip="Valore mensile stimato del traffico organico se dovesse essere pagato tramite annunci."
            />
            <MetricCard
              label="Backlink"
              value={formatNumber(latestProvider?.backlinks ?? null)}
              change={percentChange(latestProvider?.backlinks ?? null, previousProvider?.backlinks ?? null)}
              tooltip="Numero totale di backlink che puntano a questo dominio."
            />
            <MetricCard
              label="Domini di riferimento"
              value={formatNumber(latestProvider?.referring_domains ?? null)}
              change={percentChange(latestProvider?.referring_domains ?? null, previousProvider?.referring_domains ?? null)}
              tooltip="Numero di domini unici che collegano a questo sito."
            />
            <MetricCard label="Autorità del dominio" value={latestProvider?.domain_authority ?? '—'} tooltip="Punteggio di autorità stimato dal provider, 0-100." />
            <MetricCard
              label="Pagine scansionate"
              value={formatNumber(audit.urls_crawled)}
              tooltip="URL analizzati dall'ultima scansione di controllo del sito."
            />
          </div>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Punteggio di salute SEO</h2>
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
                    <p className="text-xs text-muted-foreground">Problemi critici</p>
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
                    <p className="text-xs text-muted-foreground">Avvisi</p>
                  </div>
                </CardContent>
              </Card>
            </button>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="size-6 text-success" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">{audit.passed_count}</p>
                  <p className="text-xs text-muted-foreground">Controlli superati</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {domain && <p className="text-xs text-muted-foreground">Dominio monitorato: {domain.domain}</p>}
    </div>
  )
}
