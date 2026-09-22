import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatCurrency(n: number | null | undefined, currency = 'EUR'): string {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

/**
 * Mirrors `normalize_url()` in supabase/migrations/0002_google_search_console.sql
 * exactly (lowercase, drop fragment, drop scheme, drop leading www., drop
 * trailing slash) — it's how `pages.url_normalized` and
 * `search_console_queries.page_normalized` were computed, so a client-side
 * value only lines up with them if it's produced the same way. Search
 * Console reports a page URL that can differ from the crawler's stored raw
 * URL in scheme, www, or a trailing slash alone; comparing raw strings
 * silently treats the same page as two different, unmatched ones.
 */
export function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}
