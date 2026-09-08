import { supabase } from '@/lib/supabase'

export interface CrawlSiteResponse {
  site_audit_id: string
  status: 'completed' | 'failed'
  pages_crawled?: number
  seo_score?: number
  error?: string
}

export async function startCrawl(projectId: string): Promise<{ data: CrawlSiteResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<CrawlSiteResponse>('crawl-site', {
    body: { project_id: projectId },
  })
  if (error) return { data: null, error: error.message }
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
