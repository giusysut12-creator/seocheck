import * as React from 'react'
import { ArrowRight, Clock, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  fetchFixOutcomes,
  MIN_DAYS_FOR_VERDICT,
  verdictFor,
  type FixOutcome,
  type FixVerdict,
} from '@/lib/appliedFixes'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * What happened to each published fix.
 *
 * Publishing a rewritten title is a bet whose result arrives weeks later,
 * by which point the user has forgotten what they changed. Without this the
 * tool keeps asking to be trusted and never shows its work.
 *
 * Everything here is measured, never projected: a fix with too little data
 * is labelled as such rather than given an early verdict that later
 * reverses.
 */
export function FixOutcomes({ projectId }: { projectId: string }) {
  const [outcomes, setOutcomes] = React.useState<FixOutcome[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetchFixOutcomes(projectId).then((rows) => {
      if (!cancelled) setOutcomes(rows)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (outcomes === null) return <p className="py-8 text-center text-sm text-muted-foreground">Caricamento…</p>

  if (outcomes.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="size-5" />}
        title="Nessuna correzione pubblicata"
        description="Quando pubblichi una correzione su WordPress, qui vedrai com'è andata: posizione e clic prima e dopo, misurati sui tuoi dati di Search Console."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Confronto tra i giorni prima della correzione e quelli dopo, sulla stessa parola chiave e sulla stessa pagina.
        Google impiega settimane a riscansionare una pagina e i suoi dati arrivano con circa 3 giorni di ritardo:
        prima di {MIN_DAYS_FOR_VERDICT} giorni non c'è abbastanza materiale per dire nulla.
      </p>
      {outcomes.map((o, i) => (
        <OutcomeCard key={`${o.kind}-${o.keyword}-${i}`} outcome={o} />
      ))}
    </div>
  )
}

const VERDICTS: Record<FixVerdict, { label: string; icon: typeof TrendingUp; className: string }> = {
  improved: { label: 'Migliorata', icon: TrendingUp, className: 'text-success' },
  worse: { label: 'Peggiorata', icon: TrendingDown, className: 'text-destructive' },
  unchanged: { label: 'Invariata', icon: Minus, className: 'text-muted-foreground' },
  too_early: { label: 'Troppo presto', icon: Clock, className: 'text-muted-foreground' },
  no_baseline: { label: 'Non confrontabile', icon: Minus, className: 'text-muted-foreground' },
}

function OutcomeCard({ outcome }: { outcome: FixOutcome }) {
  const verdict = verdictFor(outcome)
  const state = VERDICTS[verdict]
  const Icon = state.icon

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{outcome.keyword}</p>
            <p className="text-xs text-muted-foreground">
              Corretta il {new Date(outcome.appliedAt).toLocaleDateString('it-IT')} ·{' '}
              {outcome.after.days} {outcome.after.days === 1 ? 'giorno' : 'giorni'} di dati da allora
            </p>
          </div>
          <Badge variant="outline" className={state.className}>
            <Icon className="size-3.5" /> {state.label}
          </Badge>
        </div>

        {verdict === 'too_early' ? (
          <p className="text-xs text-muted-foreground">
            Google non ha ancora riscansionato abbastanza. Ripassa tra qualche settimana: servono almeno{' '}
            {MIN_DAYS_FOR_VERDICT} giorni di dati dopo la modifica.
          </p>
        ) : verdict === 'no_baseline' ? (
          <p className="text-xs text-muted-foreground">
            Non ci sono dati sufficienti prima della correzione per fare un confronto onesto.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <Comparison
              label="Posizione media"
              before={outcome.before.position}
              after={outcome.after.position}
              lowerIsBetter
              decimals={1}
            />
            {/* Per day, because the two windows almost never cover the same
                number of days — comparing totals would show a gain whenever
                the "after" window is simply longer. */}
            <Comparison
              label="Clic al giorno"
              before={perDay(outcome.before.clicks, outcome.before.days)}
              after={perDay(outcome.after.clicks, outcome.after.days)}
              decimals={1}
            />
            <Comparison
              label="Impressioni al giorno"
              before={perDay(outcome.before.impressions, outcome.before.days)}
              after={perDay(outcome.after.impressions, outcome.after.days)}
              decimals={0}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function perDay(total: number, days: number): number | null {
  return days > 0 ? total / days : null
}

function Comparison({
  label,
  before,
  after,
  lowerIsBetter = false,
  decimals,
}: {
  label: string
  before: number | null
  after: number | null
  lowerIsBetter?: boolean
  decimals: number
}) {
  if (before === null || after === null) return null
  const better = lowerIsBetter ? after < before : after > before
  const same = Math.abs(after - before) < 0.05

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1.5 text-foreground">
        <span className="text-muted-foreground">{before.toFixed(decimals)}</span>
        <ArrowRight className="size-3 text-muted-foreground" />
        <span className={same ? '' : better ? 'font-semibold text-success' : 'font-semibold text-destructive'}>
          {after.toFixed(decimals)}
        </span>
      </p>
    </div>
  )
}
