import * as React from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { checkProviderConfigured, seoProvider } from '@/lib/seo/seoApiProvider'
import type { CompetitorSummary, OrganicKeywordResult } from '@/lib/seo/types'
import { ProviderNotConfigured } from '@/components/ProviderNotConfigured'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/utils'

export default function Competitors() {
  const { project } = useCurrentProject()
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [competitors, setCompetitors] = React.useState<CompetitorSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
        const data = await seoProvider.getCompetitors(project!.domain, { country: project!.country })
        if (!cancelled) setCompetitors(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load competitors')
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
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading competitors…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Competitors</h1>
        <p className="text-sm text-muted-foreground">Organic competitors of {project.domain}.</p>
      </div>

      {configured === false ? (
        <ProviderNotConfigured feature="automatic competitor discovery and keyword gap analysis" />
      ) : error ? (
        <EmptyState title="Could not load competitor data" description={error} />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="gap">Keyword Gap</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {competitors.length === 0 ? (
              <EmptyState title="No competitors detected yet" description="Run more Site Audits and keyword lookups to help detect organic competitors." />
            ) : (
              <>
                <Card>
                  <CardContent className="h-64 p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={competitors.map((c) => ({ domain: c.domain, traffic: c.organicTraffic ?? 0 }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="domain" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <ChartTooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="traffic" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Competitor</TableHead>
                      <TableHead>Organic Traffic</TableHead>
                      <TableHead>Keywords</TableHead>
                      <TableHead>Common Keywords</TableHead>
                      <TableHead>Est. Traffic Value</TableHead>
                      <TableHead>Visibility</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {competitors.map((c) => (
                      <TableRow key={c.domain}>
                        <TableCell className="font-medium text-foreground">{c.domain}</TableCell>
                        <TableCell>{formatNumber(c.organicTraffic)}</TableCell>
                        <TableCell>{formatNumber(c.organicKeywords)}</TableCell>
                        <TableCell>{formatNumber(c.commonKeywords)}</TableCell>
                        <TableCell>{formatNumber(c.trafficValue)}</TableCell>
                        <TableCell>{c.visibility !== null ? `${c.visibility.toFixed(1)}%` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </TabsContent>

          <TabsContent value="gap">
            <KeywordGap domain={project.domain} country={project.country} device={project.device} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function KeywordGap({ domain, country, device }: { domain: string; country: string; device: 'desktop' | 'mobile' }) {
  const [competitorDomains, setCompetitorDomains] = React.useState<string[]>(['', '', ''])
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<{
    yours: OrganicKeywordResult[]
    competitors: { domain: string; keywords: OrganicKeywordResult[] }[]
  } | null>(null)

  async function handleCompare() {
    const domains = competitorDomains.map((d) => d.trim()).filter(Boolean).slice(0, 3)
    if (domains.length === 0) return
    setLoading(true)
    const yours = await seoProvider.getOrganicKeywords(domain, { country, device })
    const competitors = await Promise.all(
      domains.map(async (d) => ({ domain: d, keywords: await seoProvider.getOrganicKeywords(d, { country, device }) })),
    )
    setResult({ yours, competitors })
    setLoading(false)
  }

  const rows = React.useMemo(() => {
    if (!result) return []
    const yourMap = new Map(result.yours.map((k) => [k.keyword, k]))
    const out: { keyword: string; yourPosition: number | null; competitor: string; competitorPosition: number; opportunity: 'HIGH' | 'MEDIUM' | 'LOW' }[] = []
    for (const comp of result.competitors) {
      for (const k of comp.keywords) {
        const yours = yourMap.get(k.keyword)
        if (!yours) {
          out.push({ keyword: k.keyword, yourPosition: null, competitor: comp.domain, competitorPosition: k.position, opportunity: 'HIGH' })
        } else if (yours.position > k.position) {
          const gap = yours.position - k.position
          out.push({
            keyword: k.keyword,
            yourPosition: yours.position,
            competitor: comp.domain,
            competitorPosition: k.position,
            opportunity: gap > 15 ? 'HIGH' : gap > 5 ? 'MEDIUM' : 'LOW',
          })
        }
      }
    }
    return out.sort((a, b) => (a.yourPosition ?? 999) - (b.yourPosition ?? 999))
  }, [result])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {competitorDomains.map((value, i) => (
          <Input
            key={i}
            value={value}
            placeholder={`Competitor ${i + 1} domain`}
            onChange={(e) => setCompetitorDomains((prev) => prev.map((d, idx) => (idx === i ? e.target.value : d)))}
            className="w-48"
          />
        ))}
        <Button variant="accent" onClick={handleCompare} disabled={loading}>
          {loading ? 'Comparing…' : 'Compare'}
        </Button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatBox label="Common Keywords" value={rows.filter((r) => r.yourPosition !== null).length} />
            <StatBox label="You Don't Rank" value={rows.filter((r) => r.yourPosition === null).length} />
            <StatBox label="You Rank Lower" value={rows.filter((r) => r.yourPosition !== null).length} />
            <StatBox label="High-Value Gaps" value={rows.filter((r) => r.opportunity === 'HIGH').length} />
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No gap found" description="No keyword gaps detected between the compared domains." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Your Position</TableHead>
                  <TableHead>Competitor</TableHead>
                  <TableHead>Competitor Position</TableHead>
                  <TableHead>Opportunity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.keyword}-${r.competitor}-${i}`}>
                    <TableCell className="font-medium text-foreground">{r.keyword}</TableCell>
                    <TableCell>{r.yourPosition ?? '—'}</TableCell>
                    <TableCell>{r.competitor}</TableCell>
                    <TableCell>{r.competitorPosition}</TableCell>
                    <TableCell>
                      <Badge variant={r.opportunity === 'HIGH' ? 'destructive' : r.opportunity === 'MEDIUM' ? 'warning' : 'default'}>
                        {r.opportunity}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
