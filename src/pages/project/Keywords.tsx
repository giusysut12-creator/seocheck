import * as React from 'react'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import { useOrganicKeywords } from '@/hooks/useOrganicKeywords'
import { computeOpportunityScore, isKeywordOpportunity } from '@/lib/seo/opportunityScore'
import { ProviderNotConfigured } from '@/components/ProviderNotConfigured'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatNumber } from '@/lib/utils'

const INTENT_LABEL: Record<string, string> = {
  informational: 'Informational',
  navigational: 'Navigational',
  commercial: 'Commercial',
  transactional: 'Transactional',
}

function DifficultyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const variant = value >= 70 ? 'destructive' : value >= 40 ? 'warning' : 'success'
  return <Badge variant={variant}>{value}</Badge>
}

export default function Keywords() {
  const { project } = useCurrentProject()
  const { keywords, configured, loading, error } = useOrganicKeywords(project)

  const [search, setSearch] = React.useState('')
  const [intent, setIntent] = React.useState<string>('all')
  const [branded, setBranded] = React.useState<string>('all')
  const [sortBy, setSortBy] = React.useState<'position' | 'volume' | 'difficulty'>('volume')

  const filtered = React.useMemo(() => {
    return keywords
      .filter((k) => (search ? k.keyword.toLowerCase().includes(search.toLowerCase()) : true))
      .filter((k) => (intent === 'all' ? true : k.searchIntent === intent))
      .filter((k) => (branded === 'all' ? true : branded === 'branded' ? k.isBranded : !k.isBranded))
      .sort((a, b) => {
        if (sortBy === 'position') return a.position - b.position
        if (sortBy === 'difficulty') return (b.difficulty ?? 0) - (a.difficulty ?? 0)
        return (b.searchVolume ?? 0) - (a.searchVolume ?? 0)
      })
  }, [keywords, search, intent, branded, sortBy])

  const opportunities = React.useMemo(
    () =>
      keywords
        .filter(isKeywordOpportunity)
        .map((k) => ({ ...k, score: computeOpportunityScore(k) }))
        .sort((a, b) => b.score - a.score),
    [keywords],
  )

  if (!project) return null

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading keyword data…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Keywords</h1>
        <p className="text-sm text-muted-foreground">Organic keywords {project.domain} ranks for in {project.country}.</p>
      </div>

      {configured === false ? (
        <ProviderNotConfigured feature="keyword rankings, volume, difficulty and opportunity data" />
      ) : error ? (
        <EmptyState title="Could not load keyword data" description={error} />
      ) : (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All Keywords</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Search keyword…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
              <Select value={intent} onValueChange={setIntent}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Intent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All intents</SelectItem>
                  {Object.entries(INTENT_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={branded} onValueChange={setBranded}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Branded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Branded &amp; non-branded</SelectItem>
                  <SelectItem value="branded">Branded only</SelectItem>
                  <SelectItem value="non-branded">Non-branded only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">Sort: Volume</SelectItem>
                  <SelectItem value="position">Sort: Position</SelectItem>
                  <SelectItem value="difficulty">Sort: Difficulty</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="No keywords match" description="Try adjusting your filters." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Prev.</TableHead>
                    <TableHead>Volume</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>CPC</TableHead>
                    <TableHead>Traffic</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell className="font-medium text-foreground">
                        {k.keyword} {k.isBranded && <Badge variant="outline" className="ml-1">Branded</Badge>}
                      </TableCell>
                      <TableCell>{k.position}</TableCell>
                      <TableCell className="text-muted-foreground">{k.previousPosition ?? '—'}</TableCell>
                      <TableCell>{formatNumber(k.searchVolume)}</TableCell>
                      <TableCell>
                        <DifficultyBadge value={k.difficulty} />
                      </TableCell>
                      <TableCell>{formatCurrency(k.cpc)}</TableCell>
                      <TableCell>{formatNumber(k.estimatedTraffic)}</TableCell>
                      <TableCell>{k.searchIntent ? INTENT_LABEL[k.searchIntent] : '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{k.url ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="opportunities" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Keywords ranking 4-20 with meaningful volume and reachable difficulty — improving these has the fastest
              path to more traffic.
            </p>
            {opportunities.length === 0 ? (
              <EmptyState title="No opportunities found" description="No keywords currently sit in the 4-20 position range." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Volume</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Traffic</TableHead>
                    <TableHead>Opportunity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opportunities.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell className="font-medium text-foreground">{k.keyword}</TableCell>
                      <TableCell>{k.position}</TableCell>
                      <TableCell>{formatNumber(k.searchVolume)}</TableCell>
                      <TableCell>
                        <DifficultyBadge value={k.difficulty} />
                      </TableCell>
                      <TableCell>{formatNumber(k.estimatedTraffic)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${k.score}%` }} />
                          </div>
                          <span className="text-xs font-medium text-foreground">{k.score}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
