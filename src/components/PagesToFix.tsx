import * as React from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileWarning } from 'lucide-react'
import { rankPagesByIssues, type RankedPage } from '@/lib/seo/pageIssues'
import type { Page } from '@/lib/database.types'
import { AiFixSuggestion } from '@/components/AiFixSuggestion'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 25

/**
 * The crawled pages with the most wrong with them, worst first.
 *
 * The Opportunities list is built from Search Console, which only knows
 * about queries a page already gets impressions for — so the pages in the
 * worst shape, the ones ranking for nothing at all, never appear there.
 * This is the other half: everything the crawler found, ranked by how much
 * is broken, with the same fix-and-publish flow.
 */
export function PagesToFix({ projectId, pages }: { projectId: string; pages: Page[] }) {
  const [index, setIndex] = React.useState(0)
  const ranked = React.useMemo(() => rankPagesByIssues(pages), [pages])

  React.useEffect(() => setIndex(0), [ranked])

  if (pages.length === 0) {
    return (
      <EmptyState
        icon={<FileWarning className="size-5" />}
        title="Nessuna pagina scansionata"
        description="Avvia un controllo del sito: da lì esce l'elenco delle pagine con più problemi, in ordine."
      />
    )
  }

  if (ranked.length === 0) {
    return (
      <EmptyState
        icon={<FileWarning className="size-5" />}
        title="Nessun problema trovato"
        description="Tutte le pagine scansionate hanno title, meta description, H1 e contenuto a posto."
      />
    )
  }

  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const visible = ranked.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Le {ranked.length} pagine scansionate con più problemi, dalla peggiore. Non dipendono da Search Console:
        compaiono anche le pagine che oggi non si posizionano per niente.
      </p>

      {visible.map((item) => (
        <PageCard key={item.page.id} projectId={projectId} item={item} />
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
          <span>
            {index * PAGE_SIZE + 1}-{Math.min((index + 1) * PAGE_SIZE, ranked.length)} di {ranked.length}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              <ChevronLeft className="size-4" /> Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={index + 1 >= totalPages}
              onClick={() => setIndex((i) => i + 1)}
            >
              Successiva <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PageCard({ projectId, item }: { projectId: string; item: RankedPage }) {
  const { page, issues, topic } = item

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{topic}</p>
            <p className="truncate text-xs text-muted-foreground">{page.url}</p>
          </div>
          <Badge variant={issues.length > 2 ? 'destructive' : 'warning'}>
            {issues.length} {issues.length === 1 ? 'problema' : 'problemi'}
          </Badge>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cosa fare</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-foreground">
            {issues.map((issue) => (
              <li key={issue.action}>{issue.action}</li>
            ))}
          </ul>
        </div>

        <AiFixSuggestion
          projectId={projectId}
          keyword={topic}
          kind="page_issues"
          headline={`Pagina con ${issues.length} problemi rilevati dalla scansione`}
          actions={issues.map((i) => i.action)}
          page={page.url}
          pageCrawled
        />

        <Link
          to={`/projects/${projectId}/pages/${page.id}`}
          className="inline-block text-xs text-accent hover:underline"
        >
          Apri analisi pagina →
        </Link>
      </CardContent>
    </Card>
  )
}
