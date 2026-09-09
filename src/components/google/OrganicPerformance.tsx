import * as React from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import {
  change,
  dateWindow,
  fetchDailyPerformance,
  fetchPerformanceSummary,
  previousWindow,
  type DailyPerformance,
  type PerformanceSummary,
} from '@/lib/google/analytics'
import { SYNC_RANGES, type SyncRange } from '@/lib/google/searchConsole'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatDate, formatNumber } from '@/lib/utils'

/**
 * Organic performance from Search Console. These are measured clicks and
 * impressions for the selected period — not estimates — and the position
 * shown is an impression-weighted *average* over the period, never a live
 * absolute ranking.
 */
export function OrganicPerformance({ projectId }: { projectId: string }) {
  const [range, setRange] = React.useState<SyncRange>('28d')
  const [current, setCurrent] = React.useState<PerformanceSummary | null>(null)
  const [previous, setPrevious] = React.useState<PerformanceSummary | null>(null)
  const [daily, setDaily] = React.useState<DailyPerformance[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const window = dateWindow(range)
        const prior = previousWindow(window)
        const [cur, prev, series] = await Promise.all([
          fetchPerformanceSummary(projectId, window),
          fetchPerformanceSummary(projectId, prior),
          fetchDailyPerformance(projectId, window),
        ])
        if (cancelled) return
        setCurrent(cur)
        setPrevious(prev)
        setDaily(series)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load organic performance')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, range])

  if (loading) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading organic performance…</CardContent></Card>
  }
  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-5 text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    )
  }
  if (!current || current.impressions === 0) {
    return null
  }

  // A lower position number is better, so the arrow direction is inverted
  // relative to the other metrics.
  const positionDelta =
    current.position !== null && previous?.position != null ? previous.position - current.position : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Organic Performance</h2>
          <p className="text-xs text-muted-foreground">
            Measured by Google Search Console · compared with the previous {current.days} days
          </p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as SyncRange)}>
          <TabsList>
            {SYNC_RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value}>
                {r.label.replace('Last ', '')}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricTile
          label="Organic Clicks"
          value={formatNumber(current.clicks)}
          delta={change(current.clicks, previous?.clicks ?? null)}
          tooltip="Times someone clicked through to your site from Google search results."
        />
        <MetricTile
          label="Organic Impressions"
          value={formatNumber(current.impressions)}
          delta={change(current.impressions, previous?.impressions ?? null)}
          tooltip="Times a page of your site appeared in search results."
        />
        <MetricTile
          label="Average CTR"
          value={`${(current.ctr * 100).toFixed(2)}%`}
          delta={change(current.ctr, previous?.ctr ?? null)}
          tooltip="Clicks divided by impressions across the selected period."
        />
        <MetricTile
          label="Average Position"
          value={current.position !== null ? current.position.toFixed(1) : '—'}
          delta={positionDelta}
          deltaUnit="pos"
          lowerIsBetter
          tooltip="Impression-weighted average position over the period — not a live ranking for any single keyword."
        />
      </div>

      {daily.length > 1 && (
        <Card>
          <CardContent className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="gscClicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip labelFormatter={(d) => formatDate(d as string)} contentStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="clicks"
                  name="Clicks"
                  stroke="var(--color-accent)"
                  fill="url(#gscClicks)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricTile({
  label,
  value,
  delta,
  tooltip,
  deltaUnit,
  lowerIsBetter = false,
}: {
  label: string
  value: string
  delta: number | null
  tooltip: string
  deltaUnit?: string
  lowerIsBetter?: boolean
}) {
  const improved = delta === null ? null : delta > 0
  return (
    <Card>
      <CardContent className="space-y-1.5 p-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-2">
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        {delta === null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Minus className="size-3" /> no comparison data
          </p>
        ) : (
          <p className={cn('flex items-center gap-1 text-xs font-medium', improved ? 'text-success' : 'text-destructive')}>
            {improved ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {deltaUnit
              ? `${Math.abs(delta).toFixed(1)} ${deltaUnit}`
              : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
            <span className="font-normal text-muted-foreground">
              {lowerIsBetter && improved ? 'better than' : 'vs'} previous period
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
