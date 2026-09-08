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
