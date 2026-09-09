import * as React from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useCurrentProject } from '@/hooks/useCurrentProject'
import type { AuditIssue, Report, SeoOpportunity, SiteAudit } from '@/lib/database.types'
import {
  dateWindow,
  fetchKeywords,
  fetchPagePerformance,
  fetchPerformanceSummary,
  type GscKeywordRow,
  type GscPageRow,
  type PerformanceSummary,
} from '@/lib/google/analytics'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { AiAssistantCard } from '@/components/AiAssistantCard'
import { formatDate } from '@/lib/utils'

interface ReportData {
  audit: SiteAudit | null
  issues: AuditIssue[]
  opportunities: SeoOpportunity[]
  /** Search Console figures for the reporting period, when connected. */
  organic: PerformanceSummary | null
  topKeywords: GscKeywordRow[]
  topPages: GscPageRow[]
  periodFrom: string | null
  periodTo: string | null
}

export default function Reports() {
  const { project, id } = useCurrentProject()
  const { user } = useAuth()
  const [reports, setReports] = React.useState<Report[]>([])
  const [loading, setLoading] = React.useState(true)
  const [generating, setGenerating] = React.useState(false)

  const loadReports = React.useCallback(async () => {
    if (!id) return
    const { data } = await supabase.from('reports').select('*').eq('project_id', id).order('created_at', { ascending: false })
    setReports((data as Report[]) ?? [])
    setLoading(false)
  }, [id])

  React.useEffect(() => {
    loadReports()
  }, [loadReports])

  async function generateReport() {
    if (!id || !user || !project) return
    setGenerating(true)
    const { data: audit } = await supabase
      .from('site_audits')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: issues } = audit
      ? await supabase.from('audit_issues').select('*').eq('site_audit_id', (audit as SiteAudit).id).order('priority')
      : { data: [] }
    const { data: opportunities } = await supabase
      .from('seo_opportunities')
      .select('*')
      .eq('project_id', id)
      .order('opportunity_score', { ascending: false })
      .limit(15)

    // Search Console figures are included when available; a project without
    // a connection simply reports on the crawl.
    const window = dateWindow('28d')
    const [organic, keywordResult, pages] = await Promise.all([
      fetchPerformanceSummary(id, window).catch(() => null),
      fetchKeywords(id, window, { sort: 'clicks', direction: 'desc', limit: 25 }).catch(() => ({ rows: [], total: 0 })),
      fetchPagePerformance(id, window).catch(() => [] as GscPageRow[]),
    ])

    const reportData: ReportData = {
      audit: (audit as SiteAudit) ?? null,
      issues: (issues as AuditIssue[]) ?? [],
      opportunities: (opportunities as SeoOpportunity[]) ?? [],
      organic: organic && organic.impressions > 0 ? organic : null,
      topKeywords: keywordResult.rows,
      topPages: [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 25),
      periodFrom: window.from,
      periodTo: window.to,
    }

    const { data: inserted } = await supabase
      .from('reports')
      .insert({
        project_id: id,
        user_id: user.id,
        title: `SEO Report — ${project.domain} — ${new Date().toLocaleDateString()}`,
        period_start: null,
        period_end: null,
        data: reportData as unknown as Record<string, unknown>,
        status: 'ready',
      })
      .select('*')
      .single()

    setGenerating(false)
    if (inserted) setReports((prev) => [inserted as Report, ...prev])
  }

  async function exportPdf(report: Report) {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const data = report.data as unknown as ReportData
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text(report.title, 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Generated ${formatDate(report.created_at)}`, 14, 25)

    let y = 35
    doc.setTextColor(0)
    doc.setFontSize(12)
    doc.text('SEO Health Score', 14, y)
    y += 7
    doc.setFontSize(10)
    if (data.audit) {
      doc.text(
        `Score: ${data.audit.seo_score ?? '—'}/100  |  Critical: ${data.audit.critical_count}  |  Warnings: ${data.audit.warning_count}  |  Passed: ${data.audit.passed_count}`,
        14,
        y,
      )
      y += 10
    } else {
      doc.text('No Site Audit has been run yet.', 14, y)
      y += 10
    }

    if (data.organic) {
      doc.setFontSize(12)
      doc.text('Organic Performance (Google Search Console)', 14, y)
      y += 7
      doc.setFontSize(10)
      doc.text(
        `${data.periodFrom} to ${data.periodTo}  |  Clicks: ${data.organic.clicks.toLocaleString()}  |  Impressions: ${data.organic.impressions.toLocaleString()}  |  CTR: ${(data.organic.ctr * 100).toFixed(2)}%  |  Avg. position: ${data.organic.position?.toFixed(1) ?? '—'}`,
        14,
        y,
      )
      y += 10

      if (data.topKeywords.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Keyword', 'Clicks', 'Impressions', 'CTR', 'Avg. Position']],
          body: data.topKeywords.map((k) => [
            k.keyword,
            k.clicks.toLocaleString(),
            k.impressions.toLocaleString(),
            `${(k.ctr * 100).toFixed(2)}%`,
            k.position?.toFixed(1) ?? '—',
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [79, 70, 229] },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 10
      }

      if (data.topPages.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Page', 'Clicks', 'Impressions', 'Keywords', 'Avg. Position']],
          body: data.topPages.map((p) => [
            p.page,
            p.clicks.toLocaleString(),
            p.impressions.toLocaleString(),
            String(p.keyword_count),
            p.position?.toFixed(1) ?? '—',
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [79, 70, 229] },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 10
      }
    }

    if (data.issues.length > 0) {
      doc.setFontSize(12)
      doc.text('Technical Issues (Site Audit crawler)', 14, y)
      y += 4
      autoTable(doc, {
        startY: y + 4,
        head: [['Priority', 'Issue', 'Affected URLs']],
        body: data.issues.map((i) => [i.priority, i.title, String(i.affected_count)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [79, 70, 229] },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 10
    }

    if (data.opportunities.length > 0) {
      doc.setFontSize(12)
      doc.text('Top Opportunities', 14, y)
      y += 4
      autoTable(doc, {
        startY: y + 4,
        head: [['Category', 'Title', 'Impact', 'Score']],
        body: data.opportunities.map((o) => [o.category, o.title, o.potential_impact ?? '—', String(o.opportunity_score)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [79, 70, 229] },
      })
    }

    doc.save(`${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`)
  }

  if (!project) return null
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading reports…</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Generate a shareable SEO report for {project.domain}.</p>
        </div>
        <Button variant="accent" onClick={generateReport} disabled={generating}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          Generate SEO Report
        </Button>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No reports yet"
          description="Generate your first SEO report to capture your current score, issues, and top opportunities."
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.title}</p>
                  <p className="text-xs text-muted-foreground">Generated {formatDate(r.created_at)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => exportPdf(r)}>
                  <Download className="size-4" /> Export PDF
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AiAssistantCard projectId={project.id} />
    </div>
  )
}
