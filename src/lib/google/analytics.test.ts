import { describe, expect, it } from 'vitest'
import { change, dateWindow, previousWindow } from './analytics'

describe('dateWindow', () => {
  it('ends before today, because Search Console finalizes data with a lag', () => {
    const window = dateWindow('28d')
    const today = new Date().toISOString().slice(0, 10)
    expect(window.to < today).toBe(true)
  })

  it('spans the requested number of days', () => {
    const window = dateWindow('7d')
    const spanDays = (new Date(window.to).getTime() - new Date(window.from).getTime()) / 86_400_000
    expect(Math.round(spanDays)).toBe(7)
  })

  it('produces ISO dates', () => {
    const window = dateWindow('3m')
    expect(window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('previousWindow', () => {
  it('is the same length and ends the day before the current window starts', () => {
    const current = dateWindow('28d')
    const prior = previousWindow(current)

    expect(prior.days).toBe(current.days)
    expect(prior.to < current.from).toBe(true)

    const gapDays = (new Date(current.from).getTime() - new Date(prior.to).getTime()) / 86_400_000
    expect(Math.round(gapDays)).toBe(1)
  })

  it('does not overlap the current window', () => {
    const current = dateWindow('7d')
    const prior = previousWindow(current)
    expect(prior.to < current.from).toBe(true)
  })
})

describe('change', () => {
  it('computes percentage movement', () => {
    expect(change(110, 100)).toBeCloseTo(10)
    expect(change(90, 100)).toBeCloseTo(-10)
  })

  it('returns null rather than dividing by a zero baseline', () => {
    expect(change(50, 0)).toBeNull()
  })

  it('returns null when either side is missing', () => {
    expect(change(null, 100)).toBeNull()
    expect(change(100, null)).toBeNull()
  })
})
