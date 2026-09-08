// Supabase Edge Function: crawl-site
//
// Server-side SEO crawler. Given a project, it:
//   1. fetches robots.txt and sitemap.xml
//   2. crawls up to MAX_URLS pages of the domain (same-origin only),
//      respecting robots.txt disallow rules and crawl-delay
//   3. analyzes each page's HTML for on-page/technical SEO signals
//   4. persists pages, audit issues, and a computed SEO score to the DB
//
// Invoke with: POST { project_id: string }, Authorization: Bearer <user JWT>

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

// --- inlined from _shared/cors.ts ---
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// --- inlined from _shared/html.ts ---
// Lightweight, dependency-free HTML analysis helpers for the crawler.
// Regex-based rather than a full DOM parser so the function has zero npm
// dependencies and stays fast inside a Deno edge runtime.

export interface ParsedPage {
  title: string | null
  metaDescription: string | null
  h1: string[]
  h2: string[]
  canonical: string | null
  robotsMeta: string | null
  wordCount: number
  internalLinks: string[]
  externalLinks: string[]
  imagesMissingAlt: number
  imagesTotal: number
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function matchAll(re: RegExp, html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const r = new RegExp(re)
  while ((m = r.exec(html))) {
    out.push(m[1])
    if (m.index === r.lastIndex) r.lastIndex++
  }
  return out
}

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null

  const metaDescMatch =
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i.exec(html)
  const metaDescription = metaDescMatch ? decodeEntities(metaDescMatch[1].trim()) : null

  const h1 = matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, html).map((h) => decodeEntities(stripTags(h)).trim())
  const h2 = matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, html).map((h) => decodeEntities(stripTags(h)).trim())

  const canonicalMatch =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<link[^>]+href=["']([\s\S]*?)["'][^>]+rel=["']canonical["'][^>]*>/i.exec(html)
  const canonical = canonicalMatch ? canonicalMatch[1].trim() : null

  const robotsMatch =
    /<meta[^>]+name=["']robots["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i.exec(html) ||
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']robots["'][^>]*>/i.exec(html)
  const robotsMeta = robotsMatch ? robotsMatch[1].trim().toLowerCase() : null

  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
  const bodyHtml = bodyMatch ? bodyMatch[1] : html
  const textOnly = stripTags(bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''))
  const wordCount = decodeEntities(textOnly)
    .split(/\s+/)
    .filter(Boolean).length

  const base = safeUrl(pageUrl)
  const hrefs = matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi, html)
  const internalLinks: string[] = []
  const externalLinks: string[] = []
  for (const href of hrefs) {
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    const resolved = base ? safeResolve(base, href) : href
    if (!resolved) continue
    if (base && resolved.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
      internalLinks.push(resolved.toString())
    } else {
      externalLinks.push(resolved.toString())
    }
  }

  const imgTags = matchAll(/<img\s[^>]*>/gi, html)
  const imagesTotal = imgTags.length
  const imagesMissingAlt = imgTags.filter((tag) => !/alt=["'][^"']*["']/i.test(tag) || /alt=["']\s*["']/i.test(tag)).length

  return {
    title,
    metaDescription,
    h1,
    h2,
    canonical,
    robotsMeta,
    wordCount,
    internalLinks: Array.from(new Set(internalLinks)),
    externalLinks: Array.from(new Set(externalLinks)),
    imagesMissingAlt,
    imagesTotal,
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

export function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function safeResolve(base: URL, href: string): URL | null {
  try {
    return new URL(href, base)
  } catch {
    return null
  }
}

export interface RobotsRules {
  disallow: string[]
  allow: string[]
  crawlDelaySeconds: number | null
  sitemaps: string[]
}

export function parseRobotsTxt(content: string, userAgent = '*'): RobotsRules {
  const lines = content.split(/\r?\n/)
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }
  let applies = false
  let matchedSpecific = false

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'sitemap' && value) {
      rules.sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      const ua = value.toLowerCase()
      if (ua === '*' && !matchedSpecific) applies = true
      else if (ua === userAgent.toLowerCase()) {
        applies = true
        matchedSpecific = true
      } else {
        applies = false
      }
      continue
    }
    if (!applies) continue
    if (key === 'disallow' && value) rules.disallow.push(value)
    if (key === 'allow' && value) rules.allow.push(value)
    if (key === 'crawl-delay' && value) {
      const n = Number(value)
      if (!Number.isNaN(n)) rules.crawlDelaySeconds = n
    }
  }

  return rules
}

export function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  const allowMatch = rules.allow.find((p) => path.startsWith(p))
  const disallowMatch = rules.disallow.find((p) => path.startsWith(p))
  if (!disallowMatch) return true
  if (allowMatch && allowMatch.length >= disallowMatch.length) return true
  return false
}

export function extractSitemapLocs(xml: string): string[] {
  return matchAll(/<loc>([\s\S]*?)<\/loc>/gi, xml).map((s) => decodeEntities(s.trim()))
}

// --- inlined from _shared/audit.ts ---
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

const MAX_URLS = 100
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENCY = 5
const DEFAULT_DELAY_MS = 150
const USER_AGENT = 'RankPilotBot/1.0 (+https://rankpilot.app/bot)'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

interface FetchResult {
  statusCode: number | null
  redirectUrl: string | null
  html: string | null
  contentType: string | null
  loadTimeMs: number | null
  error: string | null
}

async function timedFetch(url: string): Promise<FetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const start = performance.now()
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    })
    const loadTimeMs = Math.round(performance.now() - start)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      return { statusCode: res.status, redirectUrl: location, html: null, contentType: null, loadTimeMs, error: null }
    }
    const contentType = res.headers.get('content-type')
    const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml')
    const html = isHtml ? await res.text() : null
    return { statusCode: res.status, redirectUrl: null, html, contentType, loadTimeMs, error: null }
  } catch (err) {
    const loadTimeMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'Request timed out' : err.message) : 'Fetch failed'
    return { statusCode: null, redirectUrl: null, html: null, contentType: null, loadTimeMs, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveHomepage(domain: string): Promise<{ base: URL; result: FetchResult } | null> {
  for (const scheme of ['https', 'http']) {
    const url = `${scheme}://${domain}/`
    const result = await timedFetch(url)
    if (result.statusCode !== null || result.error === null) {
      const base = safeUrl(url)
      if (base) return { base, result }
    }
  }
  return null
}

async function fetchRobots(base: URL): Promise<RobotsRules> {
  const result = await timedFetch(new URL('/robots.txt', base).toString())
  if (result.statusCode === 200 && result.html) {
    return parseRobotsTxt(result.html, USER_AGENT)
  }
  return { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }
}

async function fetchSitemapUrls(base: URL, robots: RobotsRules): Promise<string[]> {
  const candidates = robots.sitemaps.length > 0 ? robots.sitemaps : [new URL('/sitemap.xml', base).toString()]
  const found: string[] = []
  for (const sitemapUrl of candidates.slice(0, 3)) {
    const result = await timedFetch(sitemapUrl)
    if (result.statusCode === 200 && result.html) {
      const locs = extractSitemapLocs(result.html)
      // Sitemap index: recurse one level into child sitemaps.
      const childSitemaps = locs.filter((l) => l.endsWith('.xml'))
      const urlLocs = locs.filter((l) => !l.endsWith('.xml'))
      found.push(...urlLocs)
      for (const child of childSitemaps.slice(0, 3)) {
        const childResult = await timedFetch(child)
        if (childResult.statusCode === 200 && childResult.html) {
          found.push(...extractSitemapLocs(childResult.html))
        }
        if (found.length >= MAX_URLS * 2) break
      }
    }
    if (found.length >= MAX_URLS * 2) break
  }
  return Array.from(new Set(found))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: { project_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const projectId = body.project_id
  if (!projectId) return jsonResponse({ error: 'project_id is required' }, 400)

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)

  const { data: project, error: projectError } = await callerClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (projectError || !project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  let { data: domainRow } = await db
    .from('domains')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()
  if (!domainRow) {
    const { data: created } = await db
      .from('domains')
      .insert({ project_id: projectId, domain: project.domain, is_primary: true })
      .select('*')
      .single()
    domainRow = created
  }

  const { data: audit, error: auditInsertError } = await db
    .from('site_audits')
    .insert({ project_id: projectId, domain_id: domainRow?.id ?? null, status: 'crawling', started_at: new Date().toISOString() })
    .select('*')
    .single()
  if (auditInsertError || !audit) return jsonResponse({ error: 'Could not start audit' }, 500)

  try {
    const homepage = await resolveHomepage(project.domain)
    if (!homepage || homepage.result.error) {
      const message = homepage?.result.error ?? 'Domain unreachable'
      await db
        .from('site_audits')
        .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
        .eq('id', audit.id)
      return jsonResponse({ error: message, site_audit_id: audit.id }, 200)
    }

    const { base } = homepage
    const robots = await fetchRobots(base)
    const sitemapUrls = await fetchSitemapUrls(base, robots)

    const queue: string[] = [base.toString()]
    for (const u of sitemapUrls) {
      const resolved = safeUrl(u)
      if (resolved && resolved.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
        queue.push(resolved.toString())
      }
    }

    const visited = new Set<string>()
    const linkedFrom = new Set<string>()
    const results: CrawledPageResult[] = []
    const toVisit: string[] = []
    const seenQueue = new Set<string>()
    for (const u of queue) {
      const norm = normalize(u)
      if (!seenQueue.has(norm)) {
        seenQueue.add(norm)
        toVisit.push(u)
      }
    }

    let cursor = 0
    let urlsErrored = 0

    while (cursor < toVisit.length && visited.size < MAX_URLS) {
      const batch = toVisit.slice(cursor, cursor + CONCURRENCY).filter((u) => !visited.has(normalize(u)))
      cursor += CONCURRENCY
      if (batch.length === 0) continue

      const batchResults = await Promise.all(
        batch.map(async (url) => {
          const norm = normalize(url)
          if (visited.has(norm)) return null
          visited.add(norm)

          const path = safeUrl(url)?.pathname ?? '/'
          if (!isAllowedByRobots(path, robots)) {
            return {
              url,
              statusCode: null,
              redirectUrl: null,
              title: null,
              metaDescription: null,
              h1: [],
              h2Count: 0,
              canonical: null,
              robotsMeta: 'disallowed-by-robots',
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: 0,
              internalLinksCount: 0,
              externalLinksCount: 0,
              imagesMissingAlt: 0,
              loadTimeMs: null,
              isOrphan: false,
              error: 'Disallowed by robots.txt',
            } satisfies CrawledPageResult
          }

          const fetched = await timedFetch(url)
          if (fetched.error) urlsErrored++

          if (fetched.redirectUrl) {
            const target = safeUrl(new URL(fetched.redirectUrl, url).toString())
            if (target && target.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) {
              const targetNorm = normalize(target.toString())
              if (!seenQueue.has(targetNorm) && toVisit.length < MAX_URLS * 2) {
                seenQueue.add(targetNorm)
                toVisit.push(target.toString())
              }
            }
            return {
              url,
              statusCode: fetched.statusCode,
              redirectUrl: fetched.redirectUrl,
              title: null,
              metaDescription: null,
              h1: [],
              h2Count: 0,
              canonical: null,
              robotsMeta: null,
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: 0,
              internalLinksCount: 0,
              externalLinksCount: 0,
              imagesMissingAlt: 0,
              loadTimeMs: fetched.loadTimeMs,
              isOrphan: false,
              error: null,
            } satisfies CrawledPageResult
          }

          if (fetched.html) {
            const parsed = parseHtml(fetched.html, url)
            for (const link of parsed.internalLinks) {
              linkedFrom.add(normalize(link))
              const linkNorm = normalize(link)
              if (!seenQueue.has(linkNorm) && toVisit.length < MAX_URLS * 2) {
                seenQueue.add(linkNorm)
                toVisit.push(link)
              }
            }
            return {
              url,
              statusCode: fetched.statusCode,
              redirectUrl: null,
              title: parsed.title,
              metaDescription: parsed.metaDescription,
              h1: parsed.h1,
              h2Count: parsed.h2.length,
              canonical: parsed.canonical,
              robotsMeta: parsed.robotsMeta,
              isHttps: safeUrl(url)?.protocol === 'https:',
              wordCount: parsed.wordCount,
              internalLinksCount: parsed.internalLinks.length,
              externalLinksCount: parsed.externalLinks.length,
              imagesMissingAlt: parsed.imagesMissingAlt,
              loadTimeMs: fetched.loadTimeMs,
              isOrphan: false,
              error: null,
            } satisfies CrawledPageResult
          }

          return {
            url,
            statusCode: fetched.statusCode,
            redirectUrl: null,
            title: null,
            metaDescription: null,
            h1: [],
            h2Count: 0,
            canonical: null,
            robotsMeta: null,
            isHttps: safeUrl(url)?.protocol === 'https:',
            wordCount: 0,
            internalLinksCount: 0,
            externalLinksCount: 0,
            imagesMissingAlt: 0,
            loadTimeMs: fetched.loadTimeMs,
            isOrphan: false,
            error: fetched.error,
          } satisfies CrawledPageResult
        }),
      )

      for (const r of batchResults) if (r) results.push(r)

      await db
        .from('site_audits')
        .update({ urls_crawled: visited.size, urls_total: Math.min(toVisit.length, MAX_URLS), urls_errored: urlsErrored })
        .eq('id', audit.id)

      if (robots.crawlDelaySeconds) await sleep(robots.crawlDelaySeconds * 1000)
      else await sleep(DEFAULT_DELAY_MS)
    }

    // Orphan detection: pages seeded from the sitemap that no crawled page links to.
    const homepageNorm = normalize(base.toString())
    for (const r of results) {
      if (normalize(r.url) === homepageNorm) continue
      r.isOrphan = !linkedFrom.has(normalize(r.url))
    }

    const issues = buildAuditIssues(results)
    const score = computeScore(issues, results.length)

    const pageRows = results.map((r) => ({
      project_id: projectId,
      domain_id: domainRow?.id ?? null,
      url: r.url,
      title: r.title,
      meta_description: r.metaDescription,
      h1: r.h1[0] ?? null,
      h1_count: r.h1.length,
      h2_count: r.h2Count,
      canonical: r.canonical,
      robots_meta: r.robotsMeta,
      status_code: r.statusCode,
      redirect_url: r.redirectUrl,
      is_indexable: !(r.robotsMeta?.includes('noindex') ?? false),
      is_https: r.isHttps,
      word_count: r.wordCount,
      internal_links_count: r.internalLinksCount,
      external_links_count: r.externalLinksCount,
      images_missing_alt_count: r.imagesMissingAlt,
      load_time_ms: r.loadTimeMs,
      is_orphan: r.isOrphan,
      last_crawled_at: new Date().toISOString(),
    }))

    if (pageRows.length > 0) {
      await db.from('pages').upsert(pageRows, { onConflict: 'project_id,url' })
    }

    if (issues.length > 0) {
      await db.from('audit_issues').insert(
        issues.map((issue) => ({
          site_audit_id: audit.id,
          project_id: projectId,
          ...issue,
          affected_count: issue.affected_urls.length,
        })),
      )
    }

    await db
      .from('site_audits')
      .update({
        status: 'completed',
        urls_total: results.length,
        urls_crawled: results.length,
        urls_errored: urlsErrored,
        finished_at: new Date().toISOString(),
        ...score,
      })
      .eq('id', audit.id)

    // Replace previously-generated crawler opportunities for this project so
    // stale structural recommendations don't linger after they're fixed.
    await db
      .from('seo_opportunities')
      .delete()
      .eq('project_id', projectId)
      .in('category', ['technical', 'internal_linking', 'content'])
    const opportunities = buildCrawlerOpportunities(results)
    if (opportunities.length > 0) {
      await db.from('seo_opportunities').insert(
        opportunities.map((o) => ({
          project_id: projectId,
          category: o.category,
          title: o.title,
          description: o.description,
          potential_impact: o.potential_impact,
          opportunity_score: o.opportunity_score,
          recommended_actions: o.recommended_actions,
        })),
      )
    }

    if (domainRow) {
      await db.from('domain_metrics').upsert(
        {
          domain_id: domainRow.id,
          date: new Date().toISOString().slice(0, 10),
          source: 'crawler',
          seo_score: score.seo_score,
        },
        { onConflict: 'domain_id,date,source' },
      )
    }

    return jsonResponse({
      site_audit_id: audit.id,
      status: 'completed',
      pages_crawled: results.length,
      ...score,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected crawler error'
    await db
      .from('site_audits')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', audit.id)
    return jsonResponse({ error: message, site_audit_id: audit.id }, 200)
  }
})

function normalize(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    return u.toString()
  } catch {
    return url
  }
}
