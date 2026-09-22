import { supabase } from '@/lib/supabase'

/**
 * Client for the wordpress-connect Edge Function (Phase 1 of "Applica al
 * sito"). The browser never holds the Application Password beyond the one
 * request that sends it to be verified and stored — every call after that
 * only reads back non-secret status.
 */

export type SeoPlugin = 'yoast' | 'rank_math' | 'aioseo' | 'none'

export const SEO_PLUGINS: { value: SeoPlugin; label: string }[] = [
  { value: 'yoast', label: 'Yoast SEO' },
  { value: 'rank_math', label: 'Rank Math' },
  { value: 'aioseo', label: 'All in One SEO' },
  { value: 'none', label: 'Nessuno / non so' },
]

export interface WordPressStatus {
  connected: boolean
  siteUrl: string | null
  username: string | null
  seoPlugin: SeoPlugin | null
  connectedAt: string | null
  lastVerifiedAt: string | null
}

interface RawResponse {
  error?: string
  reason?: string
  connected?: boolean
  site_url?: string
  username?: string
  seo_plugin?: SeoPlugin
  connected_at?: string
  last_verified_at?: string
}

async function call(projectId: string, action: string, payload: Record<string, unknown> = {}): Promise<RawResponse> {
  const { data, error } = await supabase.functions.invoke<RawResponse>('wordpress-connect', {
    body: { action, project_id: projectId, ...payload },
  })
  if (error) {
    throw new Error(
      'Non è stato possibile raggiungere l\'integrazione WordPress. Distribuisci la Edge Function "wordpress-connect" sul tuo progetto Supabase.',
    )
  }
  if (data?.error) throw new Error(data.error)
  return data ?? {}
}

export async function getWordPressStatus(projectId: string): Promise<WordPressStatus> {
  const raw = await call(projectId, 'status')
  return {
    connected: Boolean(raw.connected),
    siteUrl: raw.site_url ?? null,
    username: raw.username ?? null,
    seoPlugin: raw.seo_plugin ?? null,
    connectedAt: raw.connected_at ?? null,
    lastVerifiedAt: raw.last_verified_at ?? null,
  }
}

export async function connectWordPress(
  projectId: string,
  input: { siteUrl: string; username: string; appPassword: string; seoPlugin: SeoPlugin },
): Promise<WordPressStatus> {
  const raw = await call(projectId, 'connect', {
    site_url: input.siteUrl,
    username: input.username,
    app_password: input.appPassword,
    seo_plugin: input.seoPlugin,
  })
  return {
    connected: Boolean(raw.connected),
    siteUrl: raw.site_url ?? null,
    username: raw.username ?? null,
    seoPlugin: input.seoPlugin,
    connectedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  }
}

export async function disconnectWordPress(projectId: string): Promise<void> {
  await call(projectId, 'disconnect')
}
