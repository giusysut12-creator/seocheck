import { describe, expect, it } from 'vitest'
import { rankPagesByIssues } from './pageIssues'
import type { Page } from '@/lib/database.types'

const page = (over: Partial<Page>): Page => ({
  id: 'p', project_id: 'proj', domain_id: null,
  url: 'https://shop.it/prodotto/zaino-sailor-moon/', url_normalized: 'shop.it/prodotto/zaino-sailor-moon',
  title: 'Un titolo perfettamente ragionevole di lunghezza giusta',
  meta_description: 'Una descrizione lunga il giusto per non essere troncata da Google nei risultati di ricerca, con un motivo per cliccare.',
  h1: 'Zaino Sailor Moon', h1_count: 1, h2_count: 3, canonical: null, robots_meta: null,
  status_code: 200, redirect_url: null, is_indexable: true, is_https: true,
  word_count: 600, internal_links_count: 10, external_links_count: 1, images_missing_alt_count: 0,
  load_time_ms: 300, is_orphan: false, last_crawled_at: null, created_at: '', updated_at: '',
  ...over,
})

describe('rankPagesByIssues', () => {
  it('leaves out a page that has nothing wrong with it', () => {
    expect(rankPagesByIssues([page({})])).toEqual([])
  })

  it('puts a page missing its title above one with a title slightly too long', () => {
    const ranked = rankPagesByIssues([
      page({ id: 'long', url: 'https://shop.it/a', title: 'x'.repeat(80) }),
      page({ id: 'none', url: 'https://shop.it/b', title: null }),
    ])
    expect(ranked.map((r) => r.page.id)).toEqual(['none', 'long'])
  })

  it('skips redirects and 404s', () => {
    // Rewriting the title of a 404 fixes nothing and pushes real
    // candidates down the list.
    const ranked = rankPagesByIssues([
      page({ id: 'gone', title: null, status_code: 404 }),
      page({ id: 'moved', title: null, status_code: 301 }),
    ])
    expect(ranked).toEqual([])
  })

  it('skips pages excluded from search on purpose', () => {
    expect(rankPagesByIssues([page({ title: null, is_indexable: false })])).toEqual([])
  })

  it('reports a thin page with the count, so the user can judge it', () => {
    const [ranked] = rankPagesByIssues([page({ word_count: 40 })])
    expect(ranked.issues.some((i) => i.action.includes('40 parole'))).toBe(true)
  })

  it('names the page by its H1, falling back to the slug', () => {
    const [byH1] = rankPagesByIssues([page({ title: null })])
    expect(byH1.topic).toBe('Zaino Sailor Moon')

    const [bySlug] = rankPagesByIssues([page({ title: null, h1: null, h1_count: 0 })])
    expect(bySlug.topic).toBe('zaino sailor moon')
  })
})
