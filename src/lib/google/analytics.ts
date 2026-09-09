import { supabase } from '@/lib/supabase'
import type { SyncRange } from '@/lib/google/searchConsole'

/**
 * Reads of synchronized Search Console data. Aggregation happens in Postgres
 * (see migration 0002) so sorting and pagination stay server-side and the
 * browser never pulls raw per-day rows.
 *
 * Every average position here is impression-weighted, and is an average over
 * the selected period — not a live absolute ranking.
 */

/** Search Console finalizes data with a lag; mirrors the sync function. */
const DATA_LAG_DAYS = 3

const RANGE_DAYS: Record<SyncRange, number> = {
  '7d': 7,
  '28d': 28,
  '3m': 90,
  '6m': 180,
  '12m': 365,
}

export interface DateWindow {
  from: string
  to: string
  days: number
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function dateWindow(range: SyncRange): DateWindow {
  const days = RANGE_DAYS[range]
  const end = new Date(Date.now() - DATA_LAG_DAYS * 24 * 60 * 60 * 1000)
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: isoDate(start), to: isoDate(end), days }
}

/** The equally-long window immediately before the given one. */
export function previousWindow(window: DateWindow): DateWindow {
  const from = new Date(window.from)
  const end = new Date(from.getTime() - 24 * 60 * 60 * 1000)
  const start = new Date(end.getTime() - window.days * 24 * 60 * 60 * 1000)
  return { from: isoDate(start), to: isoDate(end), days: window.days }
}

export interface PerformanceSummary {
  clicks: number
  impressions: number
  ctr: number
  position: number | null
  days: number
}

export async function fetchPerformanceSummary(projectId: string, window: DateWindow): Promise<PerformanceSummary> {
  const { data, error } = await supabase.rpc('gsc_performance_summary', {
    p_project_id: projectId,
    p_date_from: window.from,
    p_date_to: window.to,
  })
  if (error) throw new Error(error.message)
  const row = (data as PerformanceSummary[] | null)?.[0]
  return row ?? { clicks: 0, impressions: 0, ctr: 0, position: null, days: 0 }
}

export interface DailyPerformance {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
}

export async function fetchDailyPerformance(projectId: string, window: DateWindow): Promise<DailyPerformance[]> {
  const { data, error } = await supabase.rpc('gsc_daily_performance', {
    p_project_id: projectId,
    p_date_from: window.from,
    p_date_to: window.to,
  })
  if (error) throw new Error(error.message)
  return (data as DailyPerformance[] | null) ?? []
}

export type KeywordSegment = 'all' | 'top3' | 'top10' | 'page2' | 'page3plus'
export type KeywordSort = 'clicks' | 'impressions' | 'ctr' | 'position'

export interface GscKeywordRow {
  keyword: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
  top_page: string | null
  previous_position: number | null
  previous_clicks: number
  position_change: number | null
  total_count: number
}

export interface KeywordQueryOptions {
  search?: string
  segment?: KeywordSegment
  country?: string
  device?: string
  page?: string
  sort?: KeywordSort
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export async function fetchKeywords(
  projectId: string,
  window: DateWindow,
  options: KeywordQueryOptions = {},
): Promise<{ rows: GscKeywordRow[]; total: number }> {
  const { data, error } = await supabase.rpc('gsc_keywords', {
    p_project_id: projectId,
    p_date_from: window.from,
    p_date_to: window.to,
    p_search: options.search || null,
    p_segment: options.segment && options.segment !== 'all' ? options.segment : null,
    p_country: options.country || null,
    p_device: options.device || null,
    p_page: options.page || null,
    p_sort: options.sort ?? 'clicks',
    p_dir: options.direction ?? 'desc',
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const rows = (data as GscKeywordRow[] | null) ?? []
  return { rows, total: rows[0]?.total_count ?? 0 }
}

export interface GscPageRow {
  page: string
  page_normalized: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
  keyword_count: number
  top_keyword: string | null
}

export async function fetchPagePerformance(projectId: string, window: DateWindow): Promise<GscPageRow[]> {
  const { data, error } = await supabase.rpc('gsc_pages', {
    p_project_id: projectId,
    p_date_from: window.from,
    p_date_to: window.to,
  })
  if (error) throw new Error(error.message)
  return (data as GscPageRow[] | null) ?? []
}

export interface GscPageKeywordRow {
  keyword: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
}

export async function fetchPageKeywords(
  projectId: string,
  pageNormalized: string,
  window: DateWindow,
): Promise<GscPageKeywordRow[]> {
  const { data, error } = await supabase.rpc('gsc_page_keywords', {
    p_project_id: projectId,
    p_page_normalized: pageNormalized,
    p_date_from: window.from,
    p_date_to: window.to,
  })
  if (error) throw new Error(error.message)
  return (data as GscPageKeywordRow[] | null) ?? []
}

/** Percentage change, or null when there is no comparable baseline. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}
