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
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { parseHtml, parseRobotsTxt, isAllowedByRobots, extractSitemapLocs, safeUrl, type RobotsRules } from '../_shared/html.ts'
import { buildAuditIssues, buildCrawlerOpportunities, computeScore, type CrawledPageResult } from '../_shared/audit.ts'

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
