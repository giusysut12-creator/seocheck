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
