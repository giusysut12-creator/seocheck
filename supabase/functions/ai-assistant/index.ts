// Supabase Edge Function: ai-assistant
//
// Two things, both grounded only in data already stored for the project —
// neither ever invents a metric, keyword, or ranking that isn't present:
//
//   action: 'ask'          Answers a free-form question about the project.
//   action: 'suggest_fix'  Writes a ready-to-paste title tag and meta
//                          description for one SEO Opportunity, so the user
//                          can copy it straight into their site instead of
//                          only reading a generic recommendation.
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

async function callClaude(systemPrompt: string, userMessage: string, tools?: unknown[], toolChoice?: unknown) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1024,
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

/**
 * Writes a ready-to-paste title tag and meta description for one SEO
 * Opportunity. Grounded in the page's actual crawled title/meta/H1 when the
 * crawler has reached that URL, so the rewrite is a real edit of what's
 * there rather than an invention. Forced into a tool call (rather than free
 * text) so the result is always structured, not text to parse out of a
 * paragraph.
 */
interface PageFacts {
  title: string | null
  meta_description: string | null
  h1: string | null
  word_count: number | null
}

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
      .select('title, meta_description, h1, word_count')
      .eq('project_id', projectId)
      .eq('url', input.pageUrl)
      .maybeSingle()
    pageFacts = (data as unknown as PageFacts | null) ?? null
  }

  // The whole point of a cannibalization fix is telling the pages apart —
  // without their titles the model has nothing to differentiate them by
  // and, having only the primary page's facts, ends up writing the same
  // rewrite it would for a plain CTR opportunity on that same page.
  let competingPageFacts: { url: string; impressions: number; title: string | null }[] = []
  if (input.competingPages.length > 1) {
    const urls = input.competingPages.map((p) => p.page).slice(0, 6)
    const { data } = await db.from('pages').select('url, title').eq('project_id', projectId).in('url', urls)
    const titleByUrl = new Map(((data as { url: string; title: string | null }[] | null) ?? []).map((p) => [p.url, p.title]))
    competingPageFacts = input.competingPages
      .slice(0, 6)
      .map((p) => ({ url: p.page, impressions: p.impressions, title: titleByUrl.get(p.page) ?? null }))
  }

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
        }
      : input.pageUrl
        ? `No crawled data yet for ${input.pageUrl} — run a Site Audit so its current title/meta/H1 are known before rewriting them.`
        : 'This opportunity is not tied to one specific page.',
    competing_pages: competingPageFacts.length > 0 ? competingPageFacts : undefined,
  }

  const systemPrompt =
    'You write ready-to-paste on-page SEO fixes for an Italian e-commerce site, inside an SEO dashboard. ' +
    'Write every piece of output text in Italian. ' +
    'You must call the propose_fix tool exactly once. Ground everything ONLY in the JSON data below — never ' +
    'invent search volume, rankings, or page content that is not given to you. ' +
    'If page data says nothing was crawled yet, do not invent a title or meta description: leave both fields out ' +
    'and use notes to say a Site Audit is needed first. ' +
    'Otherwise write a title of roughly 50-60 characters and a meta description of roughly 120-155 characters, ' +
    'building on the real current_title/current_meta_description/current_h1 rather than starting from nothing, ' +
    'and keep the keyword near the front of the title. ' +
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
      description: 'Propose a ready-to-paste on-page fix for this SEO opportunity.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Suggested <title> tag in Italian, ~50-60 characters. Omit if not applicable.' },
          meta_description: { type: 'string', description: 'Suggested meta description in Italian, ~120-155 characters. Omit if not applicable.' },
          notes: { type: 'string', description: 'One or two sentences in Italian: what changed and why, or what decision the user still needs to make.' },
        },
        required: ['notes'],
      },
    },
  ]

  const json = await callClaude(systemPrompt, 'Genera la correzione per questa opportunità.', tools, {
    type: 'tool',
    name: 'propose_fix',
  })

  const toolUse = json.content?.find((c: { type?: string; name?: string }) => c.type === 'tool_use' && c.name === 'propose_fix')
  if (!toolUse) return jsonResponse({ configured: true, error: "L'AI non ha restituito una correzione strutturata." }, 200)

  const result = toolUse.input as { title?: string; meta_description?: string; notes?: string }
  return jsonResponse({
    configured: true,
    fix: {
      title: result.title ?? null,
      meta_description: result.meta_description ?? null,
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
