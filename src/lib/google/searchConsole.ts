import { supabase } from '@/lib/supabase'
import type { SearchConsoleProperty, SearchConsoleSync } from '@/lib/database.types'

/**
 * Client for the google-search-console Edge Function. Every call is proxied
 * server-side: the browser never holds a Google token, only derived data.
 */

export interface GoogleStatus {
  /** GOOGLE_CLIENT_ID / SECRET present as Edge Function secrets. */
  serverConfigured: boolean
  /** This user has authorized a Google account. */
  connected: boolean
  googleEmail: string | null
  /** A Google Ads developer token is configured server-side. */
  adsConfigured: boolean
  property: SearchConsoleProperty | null
  lastSync: SearchConsoleSync | null
}

export type SyncRange = '7d' | '28d' | '3m' | '6m' | '12m'

export const SYNC_RANGES: { value: SyncRange; label: string }[] = [
  { value: '7d', label: 'Ultimi 7 giorni' },
  { value: '28d', label: 'Ultimi 28 giorni' },
  { value: '3m', label: 'Ultimi 3 mesi' },
  { value: '6m', label: 'Ultimi 6 mesi' },
  { value: '12m', label: 'Ultimi 12 mesi' },
]

/** User-facing text for the failure reasons the Edge Function reports. */
const REASON_MESSAGES: Record<string, string> = {
  not_configured: "L'integrazione Google non è ancora configurata sul server.",
  not_connected: 'Connetti prima il tuo account Google.',
  token_expired: 'La connessione Google è scaduta. Connettiti di nuovo.',
  token_refresh_failed: "Non è stato possibile rinnovare l'accesso Google. Prova a riconnetterti.",
  no_property: 'Seleziona prima una proprietà Search Console per questo progetto.',
  no_property_access: 'Non hai accesso a questa proprietà Search Console.',
  properties_unavailable: 'Non è stato possibile leggere le tue proprietà Search Console.',
  quota_exceeded: 'Quota API di Google superata. Riprova più tardi.',
  search_analytics_failed: 'Search Console ha rifiutato la richiesta di dati.',
  storage_failed: 'I dati sono stati scaricati ma non è stato possibile salvarli.',
  unexpected: 'Qualcosa è andato storto durante la comunicazione con Google.',
}

export function describeReason(reason: string | undefined, fallback: string): string {
  if (!reason) return fallback
  return REASON_MESSAGES[reason] ?? fallback
}

interface RawResponse {
  error?: string
  reason?: string
  [key: string]: unknown
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<RawResponse>('google-search-console', {
    body: { action, ...payload },
  })
  if (error) {
    throw new Error(
      'Non è stato possibile raggiungere l\'integrazione Google. Distribuisci la Edge Function "google-search-console" sul tuo progetto Supabase.',
    )
  }
  if (data?.error) {
    throw new Error(describeReason(data.reason, data.error))
  }
  return data as T
}

export async function getGoogleStatus(projectId?: string): Promise<GoogleStatus> {
  const raw = await call<{
    server_configured: boolean
    connected: boolean
    google_email: string | null
    ads_configured: boolean
    property: SearchConsoleProperty | null
    last_sync: SearchConsoleSync | null
  }>('status', projectId ? { project_id: projectId } : {})
  return {
    serverConfigured: raw.server_configured,
    connected: raw.connected,
    googleEmail: raw.google_email,
    adsConfigured: raw.ads_configured,
    property: raw.property,
    lastSync: raw.last_sync,
  }
}

export async function startGoogleConnect(redirectTo: string): Promise<string> {
  const raw = await call<{ auth_url: string }>('auth_url', { redirect_to: redirectTo })
  return raw.auth_url
}

export async function disconnectGoogle(): Promise<void> {
  await call('disconnect')
}

export async function listProperties(): Promise<SearchConsoleProperty[]> {
  const raw = await call<{ properties: SearchConsoleProperty[] }>('list_properties')
  return raw.properties ?? []
}

export async function selectProperty(projectId: string, propertyUrl: string): Promise<SearchConsoleProperty> {
  const raw = await call<{ property: SearchConsoleProperty }>('select_property', {
    project_id: projectId,
    property_url: propertyUrl,
  })
  return raw.property
}

/**
 * A run that reached Google and stored rows. Any failure — including one the
 * server recorded as a failed sync row — is raised as an exception carrying a
 * user-facing message, so callers handle one failure path, not two.
 */
export interface SyncResult {
  status: 'completed'
  rows_imported?: number
  keywords?: number
  date_from?: string
  date_to?: string
}

export async function syncSearchConsole(
  projectId: string,
  range: SyncRange,
  dimensions?: string[],
): Promise<SyncResult> {
  return call<SyncResult>('sync', { project_id: projectId, range, dimensions })
}
