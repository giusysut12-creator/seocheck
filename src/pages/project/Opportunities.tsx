import * as React from 'react'
import { supabase } from '@/lib/supabase'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import type { SeoOpportunity } from '@/lib/database.types'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatNumber } from '@/lib/utils'
import { Sparkles } from 'lucide-react'

const CATEGORY_LABEL: Record<string, string> = {
  quick_win: 'Quick Wins',
  content: 'Content',
  keyword: 'Keyword',
  technical: 'Technical Fixes',
  internal_linking: 'Internal Linking',
  backlink: 'Backlink',
}

const IMPACT_VARIANT: Record<string, 'destructive' | 'warning' | 'default'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'default',
}

export default function Opportunities() {
  const { project, id } = useCurrentProject()
  const [opportunities, setOpportunities] = React.useState<SeoOpportunity[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!id) return
    supabase
      .from('seo_opportunities')
      .select('*')
      .eq('project_id', id)
      .eq('status', 'open')
      .order('opportunity_score', { ascending: false })
      .then(({ data }) => {
        setOpportunities((data as SeoOpportunity[]) ?? [])
        setLoading(false)
      })
  }, [id])

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading opportunities…</div>

  const quickWins = [...opportunities].sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 10)
  const byCategory = (cat: string) => opportunities.filter((o) => o.category === cat)

  const hasProviderCategories = byCategory('keyword').length > 0 || byCategory('backlink').length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">SEO Opportunities</h1>
        <p className="text-sm text-muted-foreground">Prioritized actions to improve {project.domain}'s organic performance.</p>
      </div>

      {opportunities.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="No opportunities yet"
          description="Run a Site Audit to generate technical and internal-linking opportunities. Connect an SEO data provider to unlock keyword and backlink opportunities too."
        />
      ) : (
        <Tabs defaultValue="quick_win">
          <TabsList className="flex-wrap">
            <TabsTrigger value="quick_win">Quick Wins</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="keyword">Keyword</TabsTrigger>
            <TabsTrigger value="technical">Technical Fixes</TabsTrigger>
            <TabsTrigger value="internal_linking">Internal Linking</TabsTrigger>
            <TabsTrigger value="backlink">Backlink</TabsTrigger>
          </TabsList>

          <TabsContent value="quick_win">
            <OpportunityList items={quickWins} />
          </TabsContent>
          <TabsContent value="content">
            <OpportunityList items={byCategory('content')} />
          </TabsContent>
          <TabsContent value="keyword">
            {byCategory('keyword').length === 0 && !hasProviderCategories ? (
              <EmptyState title="Connect an SEO data provider" description="Keyword opportunities need search volume and difficulty data from a connected provider." />
            ) : (
              <OpportunityList items={byCategory('keyword')} />
            )}
          </TabsContent>
          <TabsContent value="technical">
            <OpportunityList items={byCategory('technical')} />
          </TabsContent>
          <TabsContent value="internal_linking">
            <OpportunityList items={byCategory('internal_linking')} />
          </TabsContent>
          <TabsContent value="backlink">
            {byCategory('backlink').length === 0 && !hasProviderCategories ? (
              <EmptyState title="Connect an SEO data provider" description="Backlink opportunities need referring-domain data from a connected provider." />
            ) : (
              <OpportunityList items={byCategory('backlink')} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function OpportunityList({ items }: { items: SeoOpportunity[] }) {
  if (items.length === 0) return <EmptyState title="Nothing here" description="No opportunities in this category yet." />
  return (
    <div className="space-y-3">
      {items.map((o) => (
        <Card key={o.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{o.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{o.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {o.potential_impact && <Badge variant={IMPACT_VARIANT[o.potential_impact]}>{o.potential_impact.toUpperCase()}</Badge>}
                <Badge variant="outline">{CATEGORY_LABEL[o.category]}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {o.current_position !== null && <span>Current position: {o.current_position}</span>}
              {o.search_volume !== null && <span>Search volume: {formatNumber(o.search_volume)}</span>}
              {o.difficulty !== null && <span>Difficulty: {o.difficulty}</span>}
              <span>Opportunity score: {o.opportunity_score}</span>
            </div>
            {o.recommended_actions.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-foreground">
                {o.recommended_actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
