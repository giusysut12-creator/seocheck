// Supabase Edge Function: ai-assistant
//
// Two things, both grounded only in data already stored for the project —
// neither ever invents a metric, keyword, or ranking that isn't present:
//
//   action: 'ask'          Answers a free-form question about the project.
//   action: 'suggest_fix'  Works through every item in one SEO Opportunity's
//                          to-do list and produces the actual text for each —
//                          title tag, meta description, H1, new content
//                          sections, internal links — so the user can apply
//                          them instead of only reading a generic
//                          recommendation.
//
// 'suggest_fix' never touches the user's website — it returns text for the
// user to paste themselves. Auto-applying a fix to a live site would need
// write access to that site's own CMS, which this function does not have
// and was not asked to have.
//
// Configured via the AI_API_KEY secret (Anthropic Messages API). If unset,
// responds with { configured: false } so the UI can show a clear
// "AI assistant not configured" state instead of pretending to answer.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const AI_API_KEY = Deno.env.get('AI_API_KEY')
const AI_MODEL = Deno.env.get('AI_MODEL') || 'claude-sonnet-4-5'

interface CompetingPage {
  page: string
  impressions: number
  clicks: number
  position: number | null
}

interface RequestBody {
  action?: string
  project_id?: string
  question?: string
  // suggest_fix
  keyword?: string
  kind?: string
  headline?: string
  actions?: string[]
  page_url?: string | null
  /** Only for kind: 'cannibalization' — every page competing for the keyword. */
  competing_pages?: CompetingPage[]
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  tools?: unknown[],
  toolChoice?: unknown,
  maxTokens = 1024,
) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      ...(tools ? { tools, tool_choice: toolChoice } : {}),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`AI provider error: ${text}`)
  }
  return res.json()
}

async function handleAsk(db: ReturnType<typeof createClient>, projectId: string, project: { domain: string; country: string; device: string }, question: string) {
  const [{ data: audit }, { data: issues }, { data: keywords }, { data: domainMetrics }, { data: opportunities }, { data: competitors }, { data: pages }] =
    await Promise.all([
      db.from('site_audits').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('audit_issues').select('title,priority,category,affected_count').eq('project_id', projectId).order('priority').limit(15),
      db.from('keywords').select('keyword, keyword_rankings(position, previous_position, date)').eq('project_id', projectId).eq('is_tracked', true).limit(30),
      db.from('domain_metrics').select('*').order('date', { ascending: false }).limit(1).maybeSingle(),
      db.from('seo_opportunities').select('title,category,potential_impact,opportunity_score').eq('project_id', projectId).order('opportunity_score', { ascending: false }).limit(10),
      db.from('competitors').select('domain, organic_traffic, organic_keywords').eq('project_id', projectId).limit(10),
      db.from('pages').select('url, word_count, status_code').eq('project_id', projectId).order('word_count', { ascending: false }).limit(10),
    ])

  const context = {
    project,
    latest_audit: audit
      ? {
          seo_score: audit.seo_score,
          critical_issues: audit.critical_count,
          warnings: audit.warning_count,
          checks_passed: audit.passed_count,
          category_scores: {
            technical: audit.technical_score,
            onpage: audit.onpage_score,
            performance: audit.performance_score,
            indexability: audit.indexability_score,
            content: audit.content_score,
            backlinks: audit.backlinks_score,
          },
        }
      : 'No Site Audit has been run yet.',
    top_issues: issues ?? [],
    tracked_keywords: keywords ?? [],
    domain_metrics: domainMetrics ?? 'No SEO data provider connected — no traffic/keyword/backlink metrics available.',
    top_opportunities: opportunities ?? [],
    competitors: competitors ?? [],
    top_pages_by_word_count: pages ?? [],
  }

  const systemPrompt =
    'You are the AI SEO Assistant inside an SEO intelligence dashboard. Answer in Italian — the user and the ' +
    "dashboard's own interface are both Italian. " +
    'Answer the user\'s question using ONLY the JSON project data provided below — never invent metrics, ' +
    'keywords, traffic numbers, or rankings that are not present in the data. ' +
    'If the data needed to answer is missing (e.g. no SEO data provider connected, or no audit run yet), ' +
    'say so explicitly and suggest the concrete next step (e.g. "Esegui un controllo del sito" or "Connetti un provider dati SEO"). ' +
    'Every claim you make must cite the specific metric/number it is based on. Be concise and actionable.\n\n' +
    `PROJECT DATA:\n${JSON.stringify(context, null, 2)}`

  const json = await callClaude(systemPrompt, question)
  const answer = json.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? ''
  return jsonResponse({ configured: true, answer })
}

/** What the crawler knows about the page an opportunity points at. */
interface PageFacts {
  title: string | null
  meta_description: string | null
  h1: string | null
  word_count: number | null
  /**
   * The start of the page's real visible text, from the crawler. Without it
   * a to-do like "approfondisci il contenuto" can only be answered by
   * inventing what the page sells — materials, sizes, licences — which on a
   * live shop is worse than saying nothing.
   */
  content_excerpt: string | null
}

/** A real crawled page of this project, offered as a place to link FROM. */
interface LinkCandidate {
  url: string
  title: string | null
}

/**
 * Real pages of this project that plausibly relate to the keyword, so an
 * "add internal links" recommendation can name URLs that exist instead of
 * URLs that sound right. Matching is deliberately crude — the model decides
 * which candidates are actually relevant — but every candidate is a page the
 * crawler really fetched.
 */
async function findLinkCandidates(
  db: ReturnType<typeof createClient>,
  projectId: string,
  keyword: string,
  excludeUrl: string | null,
): Promise<LinkCandidate[]> {
  // The ilike patterns are built from the keyword, so anything that could
  // change the meaning of a PostgREST filter (commas, dots, parentheses,
  // wildcards) is dropped rather than escaped.
  const words = keyword
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .slice(0, 3)
  if (words.length === 0) return []

  const { data } = await db
    .from('pages')
    .select('url, title, word_count')
    .eq('project_id', projectId)
    .eq('is_indexable', true)
    .or(words.map((w) => `title.ilike.%${w}%`).join(','))
    .order('word_count', { ascending: false })
    .limit(12)

  const excluded = excludeUrl ? normalizeUrl(excludeUrl) : null
  return ((data as { url: string; title: string | null }[] | null) ?? [])
    .filter((p) => normalizeUrl(p.url) !== excluded)
    .map((p) => ({ url: p.url, title: p.title }))
}

/**
 * Mirrors normalize_url() in supabase/migrations/0002_google_search_console.sql
 * exactly — it's how pages.url_normalized was computed, so a value here only
 * lines up with that column if it's produced the same way. Search Console
 * reports a page URL that can differ from the crawler's raw stored URL by
 * scheme, www, or a trailing slash alone; matching on the raw url column
 * silently treats the same page as two different, unmatched ones.
 */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * Works through an opportunity's whole to-do list and returns the text that
 * satisfies each item. Grounded in the page's actual crawled title, meta,
 * H1 and visible text when the crawler has reached that URL, so a rewrite
 * is a real edit of what's there rather than an invention — and when it
 * hasn't, the model is told to say so instead of filling the gap. Forced
 * into a tool call (rather than free text) so the result is always
 * structured, not text to parse out of a paragraph.
 */
async function handleSuggestFix(
  db: ReturnType<typeof createClient>,
  projectId: string,
  project: { domain: string; country: string },
  input: {
    keyword: string
    kind: string
    headline: string
    actions: string[]
    pageUrl: string | null
    competingPages: CompetingPage[]
  },
) {
  let pageFacts: PageFacts | null = null
  if (input.pageUrl) {
    const { data } = await db
      .from('pages')
      .select('title, meta_description, h1, word_count, content_excerpt')
      .eq('project_id', projectId)
      .eq('url_normalized', normalizeUrl(input.pageUrl))
      .maybeSingle()
    pageFacts = (data as unknown as PageFacts | null) ?? null
  }

  // The whole point of a cannibalization fix is telling the pages apart —
  // without their titles the model has nothing to differentiate them by
  // and, having only the primary page's facts, ends up writing the same
  // rewrite it would for a plain CTR opportunity on that same page.
  let competingPageFacts: { url: string; impressions: number; title: string | null }[] = []
  if (input.competingPages.length > 1) {
    const top = input.competingPages.slice(0, 6)
    const normalizedUrls = top.map((p) => normalizeUrl(p.page))
    const { data } = await db.from('pages').select('url_normalized, title').eq('project_id', projectId).in('url_normalized', normalizedUrls)
    const titleByNormalizedUrl = new Map(
      ((data as { url_normalized: string; title: string | null }[] | null) ?? []).map((p) => [p.url_normalized, p.title]),
    )
    competingPageFacts = top.map((p) => ({
      url: p.page,
      impressions: p.impressions,
      title: titleByNormalizedUrl.get(normalizeUrl(p.page)) ?? null,
    }))
  }

  // Only worth the extra query when the to-do list actually asks for links.
  const wantsInternalLinks = input.actions.some((a) => /link interni|internal link|collegamenti interni/i.test(a))
  const linkCandidates =
    wantsInternalLinks && pageFacts ? await findLinkCandidates(db, projectId, input.keyword, input.pageUrl) : []

  const context = {
    project: { domain: project.domain, country: project.country },
    opportunity: { kind: input.kind, keyword: input.keyword, headline: input.headline, suggested_actions: input.actions },
    page: pageFacts
      ? {
          url: input.pageUrl,
          current_title: pageFacts.title,
          current_meta_description: pageFacts.meta_description,
          current_h1: pageFacts.h1,
          word_count: pageFacts.word_count,
          current_content_excerpt: pageFacts.content_excerpt,
          // The page predates the crawler storing page text. Saying so here
          // is what stops the model guessing why it has nothing to work
          // with — and a re-scan really does fix it.
          content_unavailable_reason: pageFacts.content_excerpt
            ? undefined
            : 'This page was crawled before the crawler started storing page text. Re-running the Site Audit will make the real text available.',
        }
      : input.pageUrl
        ? `No crawled data yet for ${input.pageUrl} — run a Site Audit so its current title/meta/H1 are known before rewriting them.`
        : 'This opportunity is not tied to one specific page.',
    competing_pages: competingPageFacts.length > 0 ? competingPageFacts : undefined,
    internal_link_candidates: linkCandidates.length > 0 ? linkCandidates : undefined,
  }

  const systemPrompt =
    'You write ready-to-paste on-page SEO fixes for an Italian e-commerce site, inside an SEO dashboard. ' +
    'Write every piece of output text in Italian. ' +
    // The reader is the shop owner, not a developer: they are looking at a
    // card in a dashboard, not at the JSON below. Field names leaking into
    // the text read as an error message and tell them nothing they can act
    // on.
    'You are writing to the shop owner, who is not technical and cannot see the data below. Address them directly ' +
    'as "tu". NEVER name a field, a key or a variable from the JSON (current_content_excerpt, current_title, ' +
    'word_count and the like), and never say a value is "null", "vuoto" or "mancante" — say in plain Italian what ' +
    'is missing and what to do about it. If content_unavailable_reason is present, the remedy is to re-run the ' +
    'site scan ("rilancia la scansione del sito dalla scheda Controllo del sito"), so say that instead of asking ' +
    'the owner to send you the page text. ' +
    'You must call the propose_fix tool exactly once. Ground everything ONLY in the JSON data below — never ' +
    'invent search volume, rankings, or page content that is not given to you. ' +
    'If page data says nothing was crawled yet, do not invent a title or meta description: leave both fields out ' +
    'and use notes to say a Site Audit is needed first. ' +
    // The whole point of this action: the user reads a to-do list and wants
    // the work done, not restated. Every item must come back with the actual
    // text that satisfies it, or an honest reason why it cannot.
    'suggested_actions is a to-do list. You must return one entry in steps for EVERY item, in the same order, ' +
    'copying the item verbatim into action. Each entry must carry the work itself, not a restatement of the task: ' +
    'never answer "ottimizza il titolo" with "ho ottimizzato il titolo" — say what you wrote and why it is better. ' +
    'Set done to "ai" when you have produced everything needed (the text is in your other fields or in detail), ' +
    'and "tu" when applying it needs a decision or an action only the user can take (choosing which page to ' +
    'redirect, adding a photo, changing a price) — then detail must say exactly what to do, step by step. ' +
    'Use "non_applicabile" only when the data shows the item is already satisfied, and say what shows it.\n\n' +
    'FIELD RULES\n' +
    'title: roughly 50-60 characters, keyword near the front, building on the real current_title rather than ' +
    'starting from nothing. meta_description: roughly 120-155 characters, building on current_meta_description. ' +
    'h1: only when the to-do list asks about the H1, or current_h1 is missing, empty or just the bare product ' +
    'name; it should read as a page heading for a human, not as a title tag, and must differ from title. ' +
    'content_additions: only when a to-do item asks to expand, deepen or enrich the content. Each entry is a ' +
    'ready-to-paste section with a heading and a paragraph of 40-90 words. Write them from ' +
    "current_content_excerpt — the page's real text — extending what it already says. NEVER state a material, " +
    'size, capacity, price, licence, brand, shipping term or compatibility that is not in that excerpt: on a real ' +
    'shop an invented detail is a false product claim. If current_content_excerpt is missing or too short to tell ' +
    'you what the page sells, return no content_additions and use that step\'s detail to say, in the owner\'s own ' +
    'terms, what is missing and how to get it. ' +
    'internal_links: only from URLs listed in internal_link_candidates, never invented ones, and only where the ' +
    'link makes sense for a reader; if internal_link_candidates is absent or nothing fits, say so in the step ' +
    'instead of inventing URLs.\n\n' +
    'For a "cannibalization" opportunity, do NOT write the same generic snippet rewrite you would for a plain CTR ' +
    "opportunity on that page — that ignores the actual problem. competing_pages lists every one of the project's " +
    'own pages ranking for this keyword, each with its current title where known. Use notes to name the specific ' +
    'competing URLs, say which one should stay primary for this keyword and why (usually the one with the most ' +
    'impressions, unless its content clearly fits worse), and what to do with each of the others by name — merge ' +
    'its content into the primary page, redirect it, or point it at a different, more specific query the two ' +
    'titles suggest it could own instead. Only propose a title/meta_description for the primary page, and only if ' +
    "the differentiation you describe in notes actually changes it from that page's current title — otherwise " +
    'leave title/meta_description out and let notes carry the fix. ' +
    'For a "losing_ground" opportunity, notes should point at what likely changed rather than assume a rewrite ' +
    'fixes it; only include a title/meta_description if the existing ones look like the actual cause. ' +
    "Keep notes to two or three sentences, specific enough that someone could act on them without re-reading the data.\n\n" +
    `OPPORTUNITY DATA:\n${JSON.stringify(context, null, 2)}`

  const tools = [
    {
      name: 'propose_fix',
      description: "Carry out every item in this SEO opportunity's to-do list and return the resulting text.",
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Suggested <title> tag in Italian, ~50-60 characters. Omit if not applicable.' },
          meta_description: { type: 'string', description: 'Suggested meta description in Italian, ~120-155 characters. Omit if not applicable.' },
          h1: { type: 'string', description: 'Suggested H1 heading in Italian, written for a reader. Omit unless the H1 is part of the fix.' },
          content_additions: {
            type: 'array',
            description:
              "Ready-to-paste sections extending the page's existing text. Omit entirely unless a to-do item asks to expand the content, and never include a fact absent from current_content_excerpt.",
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string', description: 'Section heading in Italian (an H2 on the page).' },
                paragraph: { type: 'string', description: "Section body in Italian, 40-90 words, grounded in the page's real text." },
              },
              required: ['heading', 'paragraph'],
            },
          },
          internal_links: {
            type: 'array',
            description: 'Links to add pointing at this page. from_url must be copied exactly from internal_link_candidates.',
            items: {
              type: 'object',
              properties: {
                from_url: { type: 'string', description: 'The candidate page the link is added to, copied verbatim.' },
                anchor_text: { type: 'string', description: 'The clickable text in Italian.' },
                reason: { type: 'string', description: 'One short sentence in Italian: why this link helps a reader.' },
              },
              required: ['from_url', 'anchor_text'],
            },
          },
          steps: {
            type: 'array',
            description: 'One entry for EVERY item in suggested_actions, in the same order.',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', description: 'The to-do item, copied verbatim from suggested_actions.' },
                done: {
                  type: 'string',
                  enum: ['ai', 'tu', 'non_applicabile'],
                  description:
                    'ai = the text is ready above or in detail; tu = needs a human decision or action; non_applicabile = already satisfied.',
                },
                detail: {
                  type: 'string',
                  description: 'In Italian: what you wrote for this item and why, or the exact steps for the user to follow.',
                },
              },
              required: ['action', 'done', 'detail'],
            },
          },
          notes: { type: 'string', description: 'One or two sentences in Italian: what changed and why, or what decision the user still needs to make.' },
        },
        required: ['notes', 'steps'],
      },
    },
  ]

  const json = await callClaude(
    systemPrompt,
    'Esegui tutte le voci della lista "cosa fare" per questa opportunità.',
    tools,
    { type: 'tool', name: 'propose_fix' },
    // A full plan — title, meta, H1, new sections, links and one entry per
    // to-do item — does not fit in the 1024 tokens a snippet rewrite needed,
    // and a truncated tool call arrives as no fix at all.
    3072,
  )

  const toolUse = json.content?.find((c: { type?: string; name?: string }) => c.type === 'tool_use' && c.name === 'propose_fix')
  if (!toolUse) return jsonResponse({ configured: true, error: "L'AI non ha restituito una correzione strutturata." }, 200)

  const result = toolUse.input as {
    title?: string
    meta_description?: string
    h1?: string
    content_additions?: { heading?: string; paragraph?: string }[]
    internal_links?: { from_url?: string; anchor_text?: string; reason?: string }[]
    steps?: { action?: string; done?: string; detail?: string }[]
    notes?: string
  }

  // A suggested link is only usable if it points at a page the crawler really
  // found. The prompt says to copy from internal_link_candidates; this drops
  // anything that didn't, rather than trusting it.
  const candidateUrls = new Set(linkCandidates.map((c) => c.url))

  return jsonResponse({
    configured: true,
    fix: {
      title: result.title ?? null,
      meta_description: result.meta_description ?? null,
      h1: result.h1 ?? null,
      content_additions: (result.content_additions ?? [])
        .filter((c) => c.heading && c.paragraph)
        .map((c) => ({ heading: c.heading!, paragraph: c.paragraph! })),
      internal_links: (result.internal_links ?? [])
        .filter((l) => l.from_url && l.anchor_text && candidateUrls.has(l.from_url))
        .map((l) => ({ from_url: l.from_url!, anchor_text: l.anchor_text!, reason: l.reason ?? '' })),
      steps: (result.steps ?? [])
        .filter((st) => st.action && st.detail)
        .map((st) => ({
          action: st.action!,
          done: st.done === 'ai' || st.done === 'non_applicabile' ? st.done : 'tu',
          detail: st.detail!,
        })),
      notes: result.notes ?? '',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'status') return jsonResponse({ configured: Boolean(AI_API_KEY) })
  if (!AI_API_KEY) return jsonResponse({ configured: false })

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401)

  const projectId = body.project_id
  if (!projectId) return jsonResponse({ error: 'project_id is required' }, 400)

  const { data: project, error: projectError } = await callerClient.from('projects').select('*').eq('id', projectId).single()
  if (projectError || !project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    if (body.action === 'suggest_fix') {
      if (!body.keyword || !body.kind || !body.headline) {
        return jsonResponse({ error: 'keyword, kind and headline are required' }, 400)
      }
      return await handleSuggestFix(db, projectId, project, {
        keyword: body.keyword,
        kind: body.kind,
        headline: body.headline,
        actions: body.actions ?? [],
        pageUrl: body.page_url ?? null,
        competingPages: body.competing_pages ?? [],
      })
    }

    if (!body.question) return jsonResponse({ error: 'question is required' }, 400)
    return await handleAsk(db, projectId, project, body.question)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI assistant request failed'
    return jsonResponse({ configured: true, error: message }, 200)
  }
})
