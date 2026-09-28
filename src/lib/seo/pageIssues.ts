import type { Page } from '@/lib/database.types'

/**
 * Ranks crawled pages by how much is wrong with them.
 *
 * Search Console only reports queries a page already gets impressions for,
 * so a page that ranks for nothing is invisible to the Opportunities list —
 * and a page with no title and no description is exactly the kind that
 * ranks for nothing. This reads the crawl instead, so the pages that need
 * the most work are the ones that surface first, whether or not Google has
 * noticed them yet.
 */

export interface PageIssue {
  /** Shown to the user as one item of the to-do list. */
  action: string
  /** Higher is worse. Summed into the page's score. */
  weight: number
}

export interface RankedPage {
  page: Page
  issues: PageIssue[]
  score: number
  /** What the page is about, for the assistant: its H1, title, or slug. */
  topic: string
}

/**
 * Weights are relative severity, not percentages. A missing title costs a
 * page every search it could appear in; a missing alt attribute costs it
 * almost nothing by comparison, and ranking them equally would bury the
 * pages actually worth an afternoon.
 */
function issuesFor(page: Page): PageIssue[] {
  const issues: PageIssue[] = []
  const title = page.title?.trim() ?? ''
  const meta = page.meta_description?.trim() ?? ''

  if (!title) {
    issues.push({ action: 'Scrivi un tag title: questa pagina non ne ha nessuno', weight: 50 })
  } else if (title.length < 25) {
    issues.push({ action: `Allunga il title: è di soli ${title.length} caratteri, ne servono circa 50-60`, weight: 20 })
  } else if (title.length > 65) {
    issues.push({ action: `Accorcia il title: a ${title.length} caratteri Google lo taglia nei risultati`, weight: 12 })
  }

  if (!meta) {
    issues.push({ action: 'Scrivi una meta description: senza, Google inventa lui il testo del risultato', weight: 30 })
  } else if (meta.length < 70) {
    issues.push({ action: `Allunga la meta description: è di ${meta.length} caratteri, ne servono circa 120-155`, weight: 12 })
  } else if (meta.length > 165) {
    issues.push({ action: `Accorcia la meta description: a ${meta.length} caratteri viene troncata`, weight: 8 })
  }

  if (page.h1_count === 0) {
    issues.push({ action: "Aggiungi un H1: la pagina non ha un titolo visibile che dica di cosa parla", weight: 25 })
  } else if (page.h1_count > 1) {
    issues.push({ action: `Lascia un solo H1: ce ne sono ${page.h1_count} e si annullano a vicenda`, weight: 10 })
  }

  const words = page.word_count ?? 0
  if (words > 0 && words < 120) {
    issues.push({ action: `Aggiungi contenuto: ${words} parole non bastano a spiegare cosa vendi`, weight: 28 })
  } else if (words >= 120 && words < 300) {
    issues.push({ action: `Approfondisci il contenuto: ${words} parole sono poche per posizionarsi`, weight: 14 })
  }

  if (page.is_orphan) {
    issues.push({ action: 'Collega questa pagina dal resto del sito: nessuna altra pagina la linka', weight: 22 })
  }

  if (page.images_missing_alt_count > 0) {
    issues.push({
      action: `Aggiungi il testo alternativo a ${page.images_missing_alt_count} immagini`,
      weight: Math.min(8, page.images_missing_alt_count),
    })
  }

  return issues
}

/** The page's own words, so the assistant knows what it is looking at. */
function topicFor(page: Page): string {
  const h1 = page.h1?.trim()
  if (h1) return h1
  const title = page.title?.trim()
  if (title) return title
  try {
    const slug = new URL(page.url).pathname.split('/').filter(Boolean).pop() ?? ''
    return slug.replace(/[-_]+/g, ' ').trim() || page.url
  } catch {
    return page.url
  }
}

/**
 * Worst first. Pages that are broken or deliberately hidden are left out:
 * a 404 is not fixed by rewriting its title, and a noindex page is excluded
 * from search on purpose — offering to "improve" either is busywork that
 * pushes the real candidates down the list.
 */
export function rankPagesByIssues(pages: Page[]): RankedPage[] {
  const ranked: RankedPage[] = []

  for (const page of pages) {
    if (page.status_code !== null && page.status_code >= 300) continue
    if (!page.is_indexable) continue

    const issues = issuesFor(page)
    if (issues.length === 0) continue

    ranked.push({
      page,
      issues,
      score: issues.reduce((sum, i) => sum + i.weight, 0),
      topic: topicFor(page),
    })
  }

  return ranked.sort((a, b) => b.score - a.score || a.page.url.localeCompare(b.page.url))
}
