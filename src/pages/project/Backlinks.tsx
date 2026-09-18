import * as React from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { checkProviderConfigured, seoProvider } from '@/lib/seo/seoApiProvider'
import type { BacklinkRecord } from '@/lib/seo/types'
import { ProviderNotConfigured } from '@/components/ProviderNotConfigured'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatNumber } from '@/lib/utils'

export default function Backlinks() {
  const { project } = useCurrentProject()
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [backlinks, setBacklinks] = React.useState<BacklinkRecord[]>([])
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
        const data = await seoProvider.getBacklinks(project!.domain)
        if (!cancelled) setBacklinks(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Caricamento backlink non riuscito')
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
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Caricamento backlink…</div>

  const referringDomains = new Set(backlinks.map((b) => b.sourceDomain)).size
  const dofollow = backlinks.filter((b) => b.linkType === 'dofollow').length
  const nofollow = backlinks.filter((b) => b.linkType === 'nofollow').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Backlink</h1>
        <p className="text-sm text-muted-foreground">Profilo dei link per {project.domain}.</p>
      </div>

      {configured === false ? (
        <ProviderNotConfigured feature="i dati sui backlink e sui domini di riferimento" />
      ) : error ? (
        <EmptyState title="Non è stato possibile caricare i dati sui backlink" description={error} />
      ) : backlinks.length === 0 ? (
        <EmptyState title="Nessun backlink trovato" description="Il tuo provider connesso non ha ancora restituito dati sui backlink per questo dominio." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(backlinks.length)}</p>
                <p className="text-xs text-muted-foreground">Backlink totali</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(referringDomains)}</p>
                <p className="text-xs text-muted-foreground">Domini di riferimento</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(dofollow)}</p>
                <p className="text-xs text-muted-foreground">Dofollow</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-foreground">{formatNumber(nofollow)}</p>
                <p className="text-xs text-muted-foreground">Nofollow</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-4 sm:flex-row">
              <div className="h-48 w-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Dofollow', value: dofollow },
                        { name: 'Nofollow', value: nofollow },
                      ]}
                      dataKey="value"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      <Cell fill="var(--color-accent)" />
                      <Cell fill="var(--color-muted-foreground)" />
                    </Pie>
                    <ChartTooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-sm text-muted-foreground">
                {dofollow} dofollow ({backlinks.length ? Math.round((dofollow / backlinks.length) * 100) : 0}%) contro {nofollow} link nofollow.
              </p>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL di origine</TableHead>
                <TableHead>URL di destinazione</TableHead>
                <TableHead>Anchor</TableHead>
                <TableHead>Autorità dominio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prima visto</TableHead>
                <TableHead>Ultimo visto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backlinks.map((b, i) => (
                <TableRow key={`${b.sourceUrl}-${i}`}>
                  <TableCell className="max-w-[200px] truncate text-xs text-accent">{b.sourceUrl}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{b.targetUrl}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{b.anchorText ?? '—'}</TableCell>
                  <TableCell>{b.sourceDomainAuthority ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={b.linkType === 'dofollow' ? 'accent' : 'outline'}>{b.linkType}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(b.firstSeen)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(b.lastSeen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}
