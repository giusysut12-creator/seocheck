import * as React from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { Info } from 'lucide-react'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { checkProviderConfigured, seoProvider } from '@/lib/seo/seoApiProvider'
import type { TrafficEstimatePoint } from '@/lib/seo/types'
import { ProviderNotConfigured } from '@/components/ProviderNotConfigured'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatNumber, formatCurrency, formatDate } from '@/lib/utils'

const RANGES = [
  { key: '7d', label: '7 giorni', days: 7 },
  { key: '30d', label: '30 giorni', days: 30 },
  { key: '3m', label: '3 mesi', days: 90 },
  { key: '6m', label: '6 mesi', days: 180 },
  { key: '12m', label: '12 mesi', days: 365 },
] as const

export default function Traffic() {
  const { project } = useCurrentProject()
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [points, setPoints] = React.useState<TrafficEstimatePoint[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [range, setRange] = React.useState<(typeof RANGES)[number]['key']>('30d')

  React.useEffect(() => {
    if (!project) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const isConfigured = await checkProviderConfigured()
        if (cancelled) return
        setConfigured(isConfigured)
        if (!isConfigured) return
        const data = await seoProvider.getTrafficEstimate(project!.domain)
        if (!cancelled) setPoints(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Caricamento dati di traffico non riuscito')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [project])

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Caricamento dati di traffico…</div>

  const days = RANGES.find((r) => r.key === range)!.days
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const filtered = points.filter((p) => new Date(p.date).getTime() >= cutoff)
  const latest = filtered[filtered.length - 1]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Traffico</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Info className="size-3.5" />
            Tutti i dati qui sotto sono <strong className="font-medium text-foreground">traffico organico stimato</strong> dal tuo
            provider dati SEO — non analitiche reali. Connetti Google Analytics/Search Console (non incluso in questo MVP) per dati
            di traffico reali.
          </p>
        </div>
      </div>

      {configured === false ? (
        <ProviderNotConfigured feature="la stima del traffico organico" />
      ) : error ? (
        <EmptyState title="Non è stato possibile caricare i dati di traffico" description={error} />
      ) : points.length === 0 ? (
        <EmptyState title="Ancora nessun dato di traffico" description="Il tuo provider connesso non ha ancora restituito una cronologia di traffico per questo dominio." />
      ) : (
        <>
          <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r.key} value={r.key}>
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(latest?.organicTraffic ?? null)}</p>
                <p className="text-xs text-muted-foreground">Traffico organico stimato (ultimo)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(latest?.organicKeywords ?? null)}</p>
                <p className="text-xs text-muted-foreground">Parole chiave organiche</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatCurrency(latest?.trafficValue ?? null)}</p>
                <p className="text-xs text-muted-foreground">Valore traffico stimato</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filtered}>
                  <defs>
                    <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip labelFormatter={(d) => formatDate(d as string)} contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="organicTraffic" stroke="var(--color-accent)" fill="url(#trafficFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
