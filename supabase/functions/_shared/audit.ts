// Turns raw crawled-page data into prioritized SEO audit issues and a
// 0-100 SEO Health Score, broken down by category.

export interface CrawledPageResult {
  url: string
  statusCode: number | null
  redirectUrl: string | null
  title: string | null
  metaDescription: string | null
  h1: string[]
  h2Count: number
  canonical: string | null
  robotsMeta: string | null
  isHttps: boolean
  wordCount: number
  internalLinksCount: number
  externalLinksCount: number
  imagesMissingAlt: number
  loadTimeMs: number | null
  isOrphan: boolean
  error: string | null
}

export type IssuePriority = 'critical' | 'high' | 'medium' | 'low'
export type IssueCategory = 'technical' | 'onpage' | 'performance' | 'indexability' | 'content' | 'backlinks'

export interface AuditIssueDraft {
  issue_type: string
  category: IssueCategory
  priority: IssuePriority
  title: string
  description: string
  why_it_matters: string
  how_to_fix: string
  affected_urls: string[]
}

interface RuleDef {
  issue_type: string
  category: IssueCategory
  priority: IssuePriority
  title: string
  description: (count: number) => string
  why_it_matters: string
  how_to_fix: string
  test: (page: CrawledPageResult) => boolean
}

const RULES: RuleDef[] = [
  {
    issue_type: 'missing_title',
    category: 'onpage',
    priority: 'critical',
    title: 'Pages missing a title tag',
    description: (n) => `${n} page(s) have no <title> tag.`,
    why_it_matters: 'The title tag is the single strongest on-page signal search engines use to understand a page, and it is what shows as the clickable headline in results.',
    how_to_fix: 'Add a unique, descriptive title (50-60 characters) to every page that includes the primary keyword near the front.',
    test: (p) => !p.title,
  },
  {
    issue_type: 'title_too_long',
    category: 'onpage',
    priority: 'medium',
    title: 'Title tag too long',
    description: (n) => `${n} page(s) have a title over 60 characters and may be truncated in search results.`,
    why_it_matters: 'Titles over ~60 characters get cut off in the SERP, hiding your value proposition or keyword from searchers.',
    how_to_fix: 'Shorten the title to 50-60 characters while keeping the primary keyword and brand name.',
    test: (p) => !!p.title && p.title.length > 60,
  },
  {
    issue_type: 'title_too_short',
    category: 'onpage',
    priority: 'low',
    title: 'Title tag too short',
    description: (n) => `${n} page(s) have a title under 30 characters.`,
    why_it_matters: 'Very short titles waste an opportunity to include relevant keywords and context that improve click-through rate.',
    how_to_fix: 'Expand the title to 50-60 characters with descriptive, relevant keywords.',
    test: (p) => !!p.title && p.title.length > 0 && p.title.length < 30,
  },
  {
    issue_type: 'missing_meta_description',
    category: 'onpage',
    priority: 'high',
    title: 'Missing meta description',
    description: (n) => `${n} page(s) have no meta description.`,
    why_it_matters: 'Without a meta description, search engines auto-generate a snippet from page content, often less compelling and lowering click-through rate.',
    how_to_fix: 'Write a unique 120-155 character meta description that summarizes the page and includes a call to action.',
    test: (p) => !p.metaDescription,
  },
  {
    issue_type: 'meta_description_too_long',
    category: 'onpage',
    priority: 'low',
    title: 'Meta description too long',
    description: (n) => `${n} page(s) have a meta description over 155 characters and may be truncated.`,
    why_it_matters: 'Long descriptions get cut off with an ellipsis in search results, potentially hiding the call to action.',
    how_to_fix: 'Trim the meta description to 120-155 characters.',
    test: (p) => !!p.metaDescription && p.metaDescription.length > 155,
  },
  {
    issue_type: 'missing_h1',
    category: 'onpage',
    priority: 'high',
    title: 'Missing H1 heading',
    description: (n) => `${n} page(s) have no H1 heading.`,
    why_it_matters: 'The H1 tells both users and search engines the main topic of the page and reinforces relevance for the target keyword.',
    how_to_fix: 'Add exactly one H1 per page that clearly states the page topic.',
    test: (p) => p.h1.length === 0,
  },
  {
    issue_type: 'multiple_h1',
    category: 'onpage',
    priority: 'medium',
    title: 'Multiple H1 headings',
    description: (n) => `${n} page(s) have more than one H1 heading.`,
    why_it_matters: 'Multiple H1s dilute topical focus and can confuse search engines about the page’s primary subject.',
    how_to_fix: 'Keep a single H1 that states the main topic and demote other headings to H2/H3.',
    test: (p) => p.h1.length > 1,
  },
  {
    issue_type: 'thin_content',
    category: 'content',
    priority: 'medium',
    title: 'Thin content',
    description: (n) => `${n} page(s) have fewer than 300 words.`,
    why_it_matters: 'Pages with very little content often struggle to rank because they provide limited value and topical depth compared to competitors.',
    how_to_fix: 'Expand the content with genuinely useful information, examples, and answers to related user questions.',
    test: (p) => p.wordCount > 0 && p.wordCount < 300,
  },
  {
    issue_type: 'missing_canonical',
    category: 'indexability',
    priority: 'medium',
    title: 'Missing canonical tag',
    description: (n) => `${n} page(s) have no canonical tag.`,
    why_it_matters: 'Without a canonical tag, search engines must guess which URL variant to index, which can split ranking signals across duplicate URLs.',
    how_to_fix: 'Add a self-referencing <link rel="canonical"> tag to every indexable page.',
    test: (p) => !p.canonical && p.statusCode === 200,
  },
  {
    issue_type: 'noindex',
    category: 'indexability',
    priority: 'high',
    title: 'Pages set to noindex',
    description: (n) => `${n} page(s) are excluded from search results via a noindex directive.`,
    why_it_matters: 'A noindex page can never rank, so unintentional noindex tags silently remove important pages from search results.',
    how_to_fix: 'Remove the noindex directive from any page that should be discoverable in search.',
    test: (p) => !!p.robotsMeta && p.robotsMeta.includes('noindex'),
  },
  {
    issue_type: 'not_https',
    category: 'technical',
    priority: 'critical',
    title: 'Page not served over HTTPS',
    description: (n) => `${n} page(s) are served over insecure HTTP.`,
    why_it_matters: 'HTTPS is a confirmed Google ranking signal and browsers flag HTTP pages as "Not Secure", hurting trust and conversions.',
    how_to_fix: 'Serve all pages over HTTPS and redirect HTTP to HTTPS with a 301.',
    test: (p) => !p.isHttps,
  },
  {
    issue_type: 'broken_page',
    category: 'technical',
    priority: 'critical',
    title: 'Broken pages (4xx/5xx)',
    description: (n) => `${n} URL(s) returned an error status code.`,
    why_it_matters: 'Broken pages waste crawl budget, create dead ends for users, and can lose any backlink equity pointing at them.',
    how_to_fix: 'Fix the underlying error, restore the content, or 301-redirect the URL to a relevant working page.',
    test: (p) => (p.statusCode ?? 0) >= 400,
  },
  {
    issue_type: 'redirect_chain',
    category: 'technical',
    priority: 'low',
    title: 'Redirected URL',
    description: (n) => `${n} URL(s) redirect instead of returning the page directly.`,
    why_it_matters: 'Redirects add latency and can dilute link equity, especially when several redirects are chained together.',
    how_to_fix: 'Update internal links and sitemaps to point directly at the final destination URL.',
    test: (p) => !!p.redirectUrl,
  },
  {
    issue_type: 'images_missing_alt',
    category: 'onpage',
    priority: 'low',
    title: 'Images missing alt text',
    description: (n) => `${n} page(s) contain images without alt attributes.`,
    why_it_matters: 'Alt text helps search engines understand image content for image search, and is essential for screen-reader accessibility.',
    how_to_fix: 'Add descriptive alt text to every meaningful image; use alt="" only for purely decorative images.',
    test: (p) => p.imagesMissingAlt > 0,
  },
  {
    issue_type: 'slow_page',
    category: 'performance',
    priority: 'medium',
    title: 'Slow-loading pages',
    description: (n) => `${n} page(s) took over 2.5s to respond.`,
    why_it_matters: 'Page speed is a ranking factor and directly affects bounce rate: slower pages convert and rank worse.',
    how_to_fix: 'Optimize server response time, compress images, and reduce render-blocking resources.',
    test: (p) => (p.loadTimeMs ?? 0) > 2500,
  },
  {
    issue_type: 'orphan_page',
    category: 'technical',
    priority: 'medium',
    title: 'Orphan pages',
    description: (n) => `${n} page(s) are in the sitemap but have no internal links pointing to them.`,
    why_it_matters: 'Orphan pages are hard for search engines and users to discover through normal browsing or crawling.',
    how_to_fix: 'Add internal links to orphan pages from relevant, well-linked pages such as category or hub pages.',
    test: (p) => p.isOrphan,
  },
  {
    issue_type: 'no_internal_links',
    category: 'technical',
    priority: 'low',
    title: 'Pages with no outgoing internal links',
    description: (n) => `${n} page(s) link to no other page on the site.`,
    why_it_matters: 'Pages that dead-end block link equity flow and make it harder for search engines to discover related content.',
    how_to_fix: 'Add contextual internal links to related pages, categories, or a navigation/footer menu.',
    test: (p) => p.statusCode === 200 && p.internalLinksCount === 0,
  },
]

export function buildAuditIssues(pages: CrawledPageResult[]): AuditIssueDraft[] {
  const issues: AuditIssueDraft[] = []

  for (const rule of RULES) {
    const affected = pages.filter(rule.test)
    if (affected.length === 0) continue
    issues.push({
      issue_type: rule.issue_type,
      category: rule.category,
      priority: rule.priority,
      title: rule.title,
      description: rule.description(affected.length),
      why_it_matters: rule.why_it_matters,
      how_to_fix: rule.how_to_fix,
      affected_urls: affected.map((p) => p.url).slice(0, 200),
    })
  }

  // Duplicate title / meta description detection across the crawled set.
  const byTitle = new Map<string, string[]>()
  const byMeta = new Map<string, string[]>()
  for (const p of pages) {
    if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.url])
    if (p.metaDescription) byMeta.set(p.metaDescription, [...(byMeta.get(p.metaDescription) ?? []), p.url])
  }
  const dupTitleUrls = Array.from(byTitle.values()).filter((urls) => urls.length > 1).flat()
  if (dupTitleUrls.length > 0) {
    issues.push({
      issue_type: 'duplicate_title',
      category: 'content',
      priority: 'high',
      title: 'Duplicate title tags',
      description: `${dupTitleUrls.length} page(s) share a title tag with another page.`,
      why_it_matters: 'Duplicate titles make it hard for search engines to differentiate pages and can cause the wrong page to rank for a query.',
      how_to_fix: 'Write a unique, specific title for each page reflecting its distinct content.',
      affected_urls: dupTitleUrls.slice(0, 200),
    })
  }
  const dupMetaUrls = Array.from(byMeta.values()).filter((urls) => urls.length > 1).flat()
  if (dupMetaUrls.length > 0) {
    issues.push({
      issue_type: 'duplicate_meta_description',
      category: 'content',
      priority: 'medium',
      title: 'Duplicate meta descriptions',
      description: `${dupMetaUrls.length} page(s) share a meta description with another page.`,
      why_it_matters: 'Duplicate descriptions reduce the uniqueness of each result in the SERP and miss a chance to differentiate pages.',
      how_to_fix: 'Write a unique meta description for each page that reflects its specific content.',
      affected_urls: dupMetaUrls.slice(0, 200),
    })
  }

  return issues.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
}

function priorityWeight(p: IssuePriority) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[p]
}

export interface ScoreBreakdown {
  seo_score: number
  technical_score: number
  onpage_score: number
  performance_score: number
  indexability_score: number
  content_score: number
  backlinks_score: number
  critical_count: number
  warning_count: number
  passed_count: number
}

const CATEGORY_KEYS: Record<IssueCategory, keyof ScoreBreakdown> = {
  technical: 'technical_score',
  onpage: 'onpage_score',
  performance: 'performance_score',
  indexability: 'indexability_score',
  content: 'content_score',
  backlinks: 'backlinks_score',
}

const TOTAL_CHECKS_PER_CATEGORY: Record<IssueCategory, number> = {
  technical: 5,
  onpage: 6,
  performance: 1,
  indexability: 2,
  content: 3,
  backlinks: 1,
}

export function computeScore(issues: AuditIssueDraft[], pagesCrawled: number): ScoreBreakdown {
  const penaltyByPriority: Record<IssuePriority, number> = { critical: 25, high: 15, medium: 8, low: 3 }
  const categoryPenalty: Record<IssueCategory, number> = {
    technical: 0,
    onpage: 0,
    performance: 0,
    indexability: 0,
    content: 0,
    backlinks: 0,
  }

  let criticalCount = 0
  let warningCount = 0

  for (const issue of issues) {
    categoryPenalty[issue.category] += penaltyByPriority[issue.priority]
    if (issue.priority === 'critical') criticalCount += issue.affected_urls.length
    else warningCount += issue.affected_urls.length
  }

  // backlinks score is neutral (0-100 midpoint) until a backlink provider is connected.
  const scores: Record<IssueCategory, number> = {
    technical: Math.max(0, 100 - categoryPenalty.technical),
    onpage: Math.max(0, 100 - categoryPenalty.onpage),
    performance: Math.max(0, 100 - categoryPenalty.performance),
    indexability: Math.max(0, 100 - categoryPenalty.indexability),
    content: Math.max(0, 100 - categoryPenalty.content),
    backlinks: 0,
  }

  const weights: Record<IssueCategory, number> = {
    technical: 0.25,
    onpage: 0.25,
    performance: 0.15,
    indexability: 0.2,
    content: 0.15,
    backlinks: 0,
  }

  const seoScore = Math.round(
    Object.entries(weights).reduce((sum, [cat, w]) => sum + scores[cat as IssueCategory] * w, 0),
  )

  const totalPossibleChecks = pagesCrawled * Object.values(TOTAL_CHECKS_PER_CATEGORY).reduce((a, b) => a + b, 0)
  const failedChecks = issues.reduce((sum, i) => sum + i.affected_urls.length, 0)
  const passedCount = Math.max(0, totalPossibleChecks - failedChecks)

  return {
    seo_score: seoScore,
    technical_score: scores.technical,
    onpage_score: scores.onpage,
    performance_score: scores.performance,
    indexability_score: scores.indexability,
    content_score: scores.content,
    backlinks_score: scores.backlinks,
    critical_count: criticalCount,
    warning_count: warningCount,
    passed_count: passedCount,
  }
}

export interface OpportunityDraft {
  category: 'technical' | 'internal_linking' | 'content'
  title: string
  description: string
  potential_impact: 'high' | 'medium' | 'low'
  opportunity_score: number
  recommended_actions: string[]
  page_url: string | null
}

/**
 * Structural opportunities derived purely from crawl data — no SEO data
 * provider required. Keyword/backlink/content-gap opportunities that need
 * search volume or competitor data are generated separately once a
 * provider is connected.
 */
export function buildCrawlerOpportunities(pages: CrawledPageResult[]): OpportunityDraft[] {
  const drafts: OpportunityDraft[] = []

  const orphans = pages.filter((p) => p.isOrphan)
  if (orphans.length > 0) {
    drafts.push({
      category: 'internal_linking',
      title: `Link to ${orphans.length} orphan page(s)`,
      description: 'These pages exist in your sitemap but have no internal links pointing to them, making them hard to discover.',
      potential_impact: orphans.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 40 + orphans.length * 5),
      recommended_actions: [
        'Add contextual internal links from related, well-linked pages',
        'Reference these pages from category or hub pages',
        'Check the pages still belong in the sitemap',
      ],
      page_url: null,
    })
  }

  const noOutlinks = pages.filter((p) => p.statusCode === 200 && p.internalLinksCount === 0)
  if (noOutlinks.length > 0) {
    drafts.push({
      category: 'internal_linking',
      title: `Add outgoing internal links on ${noOutlinks.length} page(s)`,
      description: 'These pages link to no other page on the site, which blocks link equity from flowing further into the site.',
      potential_impact: 'medium',
      opportunity_score: Math.min(100, 30 + noOutlinks.length * 4),
      recommended_actions: ['Add links to related content, category pages, or a footer/nav menu'],
      page_url: null,
    })
  }

  const slow = pages.filter((p) => (p.loadTimeMs ?? 0) > 2500)
  if (slow.length > 0) {
    drafts.push({
      category: 'technical',
      title: `Improve load time on ${slow.length} slow page(s)`,
      description: 'These pages took over 2.5s to respond, which hurts both rankings and conversion rate.',
      potential_impact: slow.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 35 + slow.length * 5),
      recommended_actions: ['Optimize server response time', 'Compress and lazy-load images', 'Reduce render-blocking scripts'],
      page_url: null,
    })
  }

  const broken = pages.filter((p) => (p.statusCode ?? 0) >= 400)
  if (broken.length > 0) {
    drafts.push({
      category: 'technical',
      title: `Fix ${broken.length} broken page(s)`,
      description: 'These URLs return an error status code, wasting crawl budget and losing any link equity pointing at them.',
      potential_impact: 'high',
      opportunity_score: Math.min(100, 50 + broken.length * 5),
      recommended_actions: ['Restore the content or 301-redirect to a relevant working page', 'Update internal links pointing at the broken URL'],
      page_url: null,
    })
  }

  const thin = pages.filter((p) => p.wordCount > 0 && p.wordCount < 300)
  if (thin.length > 0) {
    drafts.push({
      category: 'content',
      title: `Expand ${thin.length} thin content page(s)`,
      description: 'These pages have under 300 words, which usually signals limited topical depth compared to ranking competitors.',
      potential_impact: thin.length > 5 ? 'high' : 'medium',
      opportunity_score: Math.min(100, 30 + thin.length * 4),
      recommended_actions: ['Add genuinely useful depth: examples, data, FAQs', 'Cover related sub-topics and entities', 'Improve internal links into the page'],
      page_url: null,
    })
  }

  return drafts
}

export { CATEGORY_KEYS }
