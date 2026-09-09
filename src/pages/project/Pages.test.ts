import { describe, expect, it } from 'vitest'
import { mergePagesWithOrganic, pageIssueCount } from './Pages'
import type { Page } from '@/lib/database.types'
import type { GscPageRow } from '@/lib/google/analytics'

function crawledPage(overrides: Partial<Page> & { url: string; url_normalized: string }): Page {
  return {
    id: overrides.url,
    project_id: 'p1',
    domain_id: null,
    title: 'Title',
    meta_description: 'Description',
    h1: 'Heading',
    h1_count: 1,
    h2_count: 2,
    canonical: null,
    robots_meta: null,
    status_code: 200,
    redirect_url: null,
    is_indexable: true,
    is_https: true,
    word_count: 1200,
    internal_links_count: 10,
    external_links_count: 2,
    images_missing_alt_count: 0,
    load_time_ms: 300,
    is_orphan: false,
    last_crawled_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function organicRow(overrides: Partial<GscPageRow> & { page: string; page_normalized: string }): GscPageRow {
  return {
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: null,
    keyword_count: 0,
    top_keyword: null,
    ...overrides,
  }
}

describe('mergePagesWithOrganic', () => {
  it('matches a crawled URL to its Search Console row despite www and trailing-slash differences', () => {
    // The crawler stores what it fetched; Search Console reports its own form.
    const crawled = [
      crawledPage({ url: 'https://www.example.com/seo-audit/', url_normalized: 'example.com/seo-audit' }),
    ]
    const organic = [
      organicRow({
        page: 'https://example.com/seo-audit',
        page_normalized: 'example.com/seo-audit',
        clicks: 1240,
        impressions: 32_400,
      }),
    ]

    const merged = mergePagesWithOrganic(crawled, organic)

    expect(merged).toHaveLength(1)
    expect(merged[0].crawled).not.toBeNull()
    expect(merged[0].organic?.clicks).toBe(1240)
  })

  it('keeps a URL Search Console knows about but the crawler never reached', () => {
    const merged = mergePagesWithOrganic(
      [],
      [organicRow({ page: 'https://example.com/orphan', page_normalized: 'example.com/orphan', clicks: 5 })],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].crawled).toBeNull()
    expect(merged[0].organic).not.toBeNull()
  })

  it('keeps a crawled page with no organic traffic', () => {
    const merged = mergePagesWithOrganic(
      [crawledPage({ url: 'https://example.com/draft', url_normalized: 'example.com/draft' })],
      [],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].organic).toBeNull()
  })

  it('orders by clicks, with pages that have no traffic last', () => {
    const merged = mergePagesWithOrganic(
      [
        crawledPage({ url: 'https://example.com/a', url_normalized: 'example.com/a' }),
        crawledPage({ url: 'https://example.com/b', url_normalized: 'example.com/b' }),
      ],
      [organicRow({ page: 'https://example.com/b', page_normalized: 'example.com/b', clicks: 50 })],
    )

    expect(merged[0].url).toBe('https://example.com/b')
    expect(merged[1].organic).toBeNull()
  })
})

describe('pageIssueCount', () => {
  it('reports nothing for a healthy page', () => {
    expect(pageIssueCount(crawledPage({ url: 'u', url_normalized: 'u' }))).toBe(0)
  })

  it('counts each problem the crawler actually recorded', () => {
    const problematic = crawledPage({
      url: 'u',
      url_normalized: 'u',
      title: null,
      meta_description: null,
      h1_count: 0,
      images_missing_alt_count: 3,
      word_count: 120,
    })
    expect(pageIssueCount(problematic)).toBe(5)
  })

  it('reports nothing when there is no crawl data at all', () => {
    expect(pageIssueCount(null)).toBe(0)
  })
})
