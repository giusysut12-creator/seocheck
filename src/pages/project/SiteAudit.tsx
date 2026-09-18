import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronDown, Loader2, ScanSearch, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useLatestAudit } from '@/hooks/useLatestAudit'
import { startCrawl } from '@/lib/edgeFunctions'
import type { AuditIssue, IssuePriority } from '@/lib/database.types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'

const PRIORITY_STYLES: Record<IssuePriority, { badge: 'destructive' | 'warning' | 'default'; label: string }> = {
  critical: { badge: 'destructive', label: 'Critico' },
  high: { badge: 'warning', label: 'Alto' },
  medium: { badge: 'default', label: 'Medio' },
  low: { badge: 'default', label: 'Basso' },
}

const PRIORITY_ORDER: IssuePriority[] = ['critical', 'high', 'medium', 'low']

/** The category slug is stored as-is in the database; only its display changes. */
const CATEGORY_LABELS: Record<string, string> = {
  onpage: 'On-page',
  content: 'Contenuti',
  indexability: 'Indicizzabilità',
  technical: 'Tecnica',
  performance: 'Performance',
  internal_linking: 'Link interni',
}

export default function SiteAudit() {
  const { project, id } = useCurrentProject()
  const { audit, refresh } = useLatestAudit(id)
  const [issues, setIssues] = React.useState<AuditIssue[]>([])
  const [loadingIssues, setLoadingIssues] = React.useState(true)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)
  const [params, setParams] = useSearchParams()

  const activeFilter = (params.get('priority')?.split(',').filter(Boolean) as IssuePriority[]) ?? []

  React.useEffect(() => {
    if (!audit || audit.status !== 'completed') {
      setIssues([])
      setLoadingIssues(false)
      return
    }
    setLoadingIssues(true)
    supabase
      .from('audit_issues')
      .select('*')
      .eq('site_audit_id', audit.id)
      .order('priority', { ascending: true })
      .then(({ data }) => {
        setIssues((data as AuditIssue[]) ?? [])
        setLoadingIssues(false)
      })
  }, [audit])

  async function handleRunAudit() {
    if (!project) return
    setRunning(true)
    await startCrawl(project.id)
    setRunning(false)
    refresh()
  }

  function toggleFilter(priority: IssuePriority) {
    const next = activeFilter.includes(priority) ? activeFilter.filter((p) => p !== priority) : [...activeFilter, priority]
    if (next.length === 0) params.delete('priority')
    else params.set('priority', next.join(','))
    setParams(params, { replace: true })
  }

  const filtered = activeFilter.length > 0 ? issues.filter((i) => activeFilter.includes(i.priority)) : issues
  const sorted = [...filtered].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))

  const counts = PRIORITY_ORDER.reduce<Record<IssuePriority, number>>(
    (acc, p) => ({ ...acc, [p]: issues.filter((i) => i.priority === p).length }),
    { critical: 0, high: 0, medium: 0, low: 0 },
  )

  if (!project) return null

  const isCrawling = audit?.status === 'crawling' || audit?.status === 'pending'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Controllo del sito</h1>
          <p className="text-sm text-muted-foreground">Problemi SEO tecnici e on-page trovati su {project.domain}.</p>
        </div>
        <Button variant="accent" onClick={handleRunAudit} disabled={running || isCrawling}>
          {running || isCrawling ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
          {isCrawling ? 'Scansione in corso…' : 'Avvia nuovo controllo'}
        </Button>
      </div>

      {!audit && (
        <EmptyState
          icon={<ScanSearch className="size-5" />}
          title="Ancora nessun controllo"
          description="Avvia un controllo del sito per scansionare il tuo sito web e individuare i problemi SEO in ordine di priorità."
          action={
            <Button variant="accent" onClick={handleRunAudit} disabled={running}>
              Avvia controllo del sito
            </Button>
          }
        />
      )}

      {audit && audit.status === 'completed' && (
        <>
          <div className="flex flex-wrap gap-2">
            {PRIORITY_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => toggleFilter(p)}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors',
                  activeFilter.includes(p) ? 'border-accent bg-accent/10 text-accent' : 'hover:bg-muted',
                )}
              >
                {p === 'critical' && <ShieldAlert className="size-3.5" />}
                {p === 'high' && <AlertTriangle className="size-3.5" />}
                {(p === 'medium' || p === 'low') && <ShieldQuestion className="size-3.5" />}
                {PRIORITY_STYLES[p].label}
                <span className="text-xs text-muted-foreground">{counts[p]}</span>
              </button>
            ))}
          </div>

          {loadingIssues ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Caricamento dei problemi…</div>
          ) : sorted.length === 0 ? (
            <EmptyState title="Nessun problema trovato" description="Ottimo lavoro — nessun problema corrisponde a questo filtro." />
          ) : (
            <div className="space-y-2">
              {sorted.map((issue) => {
                const isOpen = expanded === issue.id
                return (
                  <Card key={issue.id}>
                    <button className="w-full text-left" onClick={() => setExpanded(isOpen ? null : issue.id)}>
                      <CardContent className="flex items-center gap-3 p-4">
                        <Badge variant={PRIORITY_STYLES[issue.priority].badge}>{PRIORITY_STYLES[issue.priority].label}</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{issue.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{issue.description}</p>
                        </div>
                        <Badge variant="outline">
                          {CATEGORY_LABELS[issue.category] ?? issue.category}
                        </Badge>
                        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                      </CardContent>
                    </button>
                    {isOpen && (
                      <CardContent className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Perché è importante</p>
                            <p className="mt-1 text-sm text-foreground">{issue.why_it_matters}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Come risolverlo</p>
                            <p className="mt-1 text-sm text-foreground">{issue.how_to_fix}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            URL interessati ({issue.affected_count})
                          </p>
                          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs">
                            {issue.affected_urls.map((url) => (
                              <li key={url} className="truncate text-accent">
                                <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
                                  {url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {audit?.status === 'failed' && (
        <EmptyState title="Ultimo controllo non riuscito" description={audit.error_message ?? 'Non è stato possibile scansionare il dominio.'} />
      )}
    </div>
  )
}
