import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface CrawlSiteResponse {
  site_audit_id: string
  status: 'completed' | 'failed'
  pages_crawled?: number
  seo_score?: number
  error?: string
}

const NOT_DEPLOYED =
  'Could not reach the Site Audit crawler. Deploy the "crawl-site" Edge Function to your Supabase project — Settings shows its current status.'

/**
 * Turns a raw Edge Function invocation failure into something a user can act
 * on: a missing deployment reads very differently from an error the function
 * itself returned, and the raw SDK message distinguishes neither.
 */
async function describeInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status
    if (status === 404) return NOT_DEPLOYED
    const body = await error.context?.json?.().catch(() => null)
    if (body?.error) return body.error as string
    return `The crawler returned an error (HTTP ${status ?? 'unknown'}).`
  }
  return NOT_DEPLOYED
}

export async function startCrawl(projectId: string): Promise<{ data: CrawlSiteResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<CrawlSiteResponse>('crawl-site', {
    body: { project_id: projectId },
  })
  if (error) return { data: null, error: await describeInvokeError(error) }
  if (data?.error) return { data, error: data.error }
  return { data: data ?? null, error: null }
}

export interface AiAssistantResponse {
  configured: boolean
  answer?: string
  error?: string
}

export async function askAiAssistant(
  projectId: string,
  question: string,
): Promise<{ configured: boolean; answer: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<AiAssistantResponse>('ai-assistant', {
    body: { project_id: projectId, question },
  })
  if (error) return { configured: true, answer: null, error: error.message }
  if (!data) return { configured: false, answer: null, error: null }
  if (!data.configured) return { configured: false, answer: null, error: null }
  if (data.error) return { configured: true, answer: null, error: data.error }
  return { configured: true, answer: data.answer ?? null, error: null }
}
