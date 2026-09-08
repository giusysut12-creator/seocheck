// Supabase Edge Function: ai-assistant
//
// Answers natural-language questions about a project using ONLY the data
// already stored for that project (site audits, tracked keyword rankings,
// domain metrics, opportunities, competitors, top pages). Never invents
// numbers: if the data needed isn't available (e.g. no SEO provider
// connected yet), the assistant is instructed to say so.
//
// Configured via the AI_API_KEY secret (Anthropic Messages API). If unset,
// responds with { configured: false } so the UI can show a clear
// "AI assistant not configured" state instead of pretending to answer.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const AI_API_KEY = Deno.env.get('AI_API_KEY')
const AI_MODEL = Deno.env.get('AI_MODEL') || 'claude-sonnet-4-5'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: { action?: string; project_id?: string; question?: string }
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

  const { project_id: projectId, question } = body
  if (!projectId || !question) return jsonResponse({ error: 'project_id and question are required' }, 400)

  const { data: project, error: projectError } = await callerClient.from('projects').select('*').eq('id', projectId).single()
  if (projectError || !project) return jsonResponse({ error: 'Project not found or access denied' }, 404)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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
    project: { domain: project.domain, country: project.country, device: project.device },
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
    'You are the AI SEO Assistant inside an SEO intelligence dashboard. ' +
    'Answer the user\'s question using ONLY the JSON project data provided below — never invent metrics, ' +
    'keywords, traffic numbers, or rankings that are not present in the data. ' +
    'If the data needed to answer is missing (e.g. no SEO data provider connected, or no audit run yet), ' +
    'say so explicitly and suggest the concrete next step (e.g. "Run a Site Audit" or "Connect an SEO data provider"). ' +
    'Every claim you make must cite the specific metric/number it is based on. Be concise and actionable.\n\n' +
    `PROJECT DATA:\n${JSON.stringify(context, null, 2)}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AI_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return jsonResponse({ configured: true, error: `AI provider error: ${text}` }, 200)
    }
    const json = await res.json()
    const answer = json.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? ''
    return jsonResponse({ configured: true, answer })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI assistant request failed'
    return jsonResponse({ configured: true, error: message }, 200)
  }
})
