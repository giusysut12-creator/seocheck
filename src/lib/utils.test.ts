import { describe, expect, it } from 'vitest'
import { normalizeUrl } from './utils'

describe('normalizeUrl', () => {
  // Cross-checked against the real Postgres normalize_url() this mirrors —
  // supabase/migrations/0002_google_search_console.sql — with a local
  // Postgres 16, same inputs, byte-for-byte identical output. It has to stay
  // that way: `pages.url_normalized` and `search_console_queries.page_normalized`
  // are computed by that SQL function, so a client-side value only lines up
  // with them if it's produced the same way.
  it('treats scheme, www, and a trailing slash as the same page', () => {
    const variants = [
      'https://www.shophomegames.it/prodotto/lilo-stitch-coin-bank-angel-twink-15-cm/',
      'https://shophomegames.it/prodotto/lilo-stitch-coin-bank-angel-twink-15-cm',
      'http://www.shophomegames.it/prodotto/lilo-stitch-coin-bank-angel-twink-15-cm/',
      'www.shophomegames.it/prodotto/lilo-stitch-coin-bank-angel-twink-15-cm',
    ]
    const normalized = new Set(variants.map(normalizeUrl))
    expect(normalized.size).toBe(1)
    expect([...normalized][0]).toBe('shophomegames.it/prodotto/lilo-stitch-coin-bank-angel-twink-15-cm')
  })

  it('lowercases the whole URL', () => {
    expect(normalizeUrl('HTTPS://WWW.ShopHomeGames.it/Prodotto/Lilo-Stitch/')).toBe('shophomegames.it/prodotto/lilo-stitch')
  })

  it('drops a fragment but keeps the query string', () => {
    expect(normalizeUrl('https://www.shophomegames.it/prodotto/x?utm_source=google#reviews')).toBe(
      'shophomegames.it/prodotto/x?utm_source=google',
    )
  })

  it('strips every trailing slash, not just one', () => {
    expect(normalizeUrl('https://www.shophomegames.it///prodotto/x///')).toBe('shophomegames.it///prodotto/x')
  })

  it('reduces a bare homepage to just the host', () => {
    expect(normalizeUrl('https://www.shophomegames.it')).toBe('shophomegames.it')
    expect(normalizeUrl('https://www.shophomegames.it/')).toBe('shophomegames.it')
  })
})
