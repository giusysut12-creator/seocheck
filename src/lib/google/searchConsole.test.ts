import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Edge Function is the boundary here: these tests exercise the client's
// contract with it — argument shape, error translation, and the guarantee
// that no Google credential ever reaches this layer.
const invoke = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

const {
  describeReason,
  disconnectGoogle,
  getGoogleStatus,
  listProperties,
  selectProperty,
  startGoogleConnect,
  syncSearchConsole,
} = await import('./searchConsole')

beforeEach(() => invoke.mockReset())

describe('getGoogleStatus', () => {
  it('maps the Edge Function payload into the client shape', async () => {
    invoke.mockResolvedValue({
      data: {
        server_configured: true,
        connected: true,
        google_email: 'user@example.com',
        ads_configured: false,
        property: { id: 'p1', property_url: 'sc-domain:example.com' },
        last_sync: { status: 'completed' },
      },
      error: null,
    })

    const status = await getGoogleStatus('project-1')

    expect(status.connected).toBe(true)
    expect(status.googleEmail).toBe('user@example.com')
    expect(status.adsConfigured).toBe(false)
    expect(status.property?.property_url).toBe('sc-domain:example.com')
    expect(invoke).toHaveBeenCalledWith('google-search-console', {
      body: { action: 'status', project_id: 'project-1' },
    })
  })

  it('never receives a token: the payload carries no credential fields', async () => {
    invoke.mockResolvedValue({
      data: { server_configured: true, connected: true, google_email: 'u@e.com', ads_configured: false },
      error: null,
    })
    const status = await getGoogleStatus()
    expect(JSON.stringify(status)).not.toMatch(/refresh_token|access_token/)
  })

  it('reports a missing deployment as an actionable message', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } })
    await expect(getGoogleStatus()).rejects.toThrow(/Deploy the "google-search-console" Edge Function/)
  })
})

describe('error translation', () => {
  it('turns a revoked grant into reconnect guidance', async () => {
    invoke.mockResolvedValue({ data: { error: 'raw', reason: 'token_expired' }, error: null })
    await expect(listProperties()).rejects.toThrow(/expired.*connect again/i)
  })

  it('explains a property the user cannot read', async () => {
    invoke.mockResolvedValue({ data: { error: 'raw', reason: 'no_property_access' }, error: null })
    await expect(selectProperty('p1', 'sc-domain:other.com')).rejects.toThrow(
      /don't have access to this Search Console property/i,
    )
  })

  it('explains a quota rejection', async () => {
    invoke.mockResolvedValue({ data: { error: 'raw', reason: 'quota_exceeded' }, error: null })
    await expect(listProperties()).rejects.toThrow(/quota exceeded/i)
  })

  it('falls back to the server message for an unrecognized reason', () => {
    expect(describeReason('something_new', 'server text')).toBe('server text')
    expect(describeReason(undefined, 'server text')).toBe('server text')
  })
})

describe('startGoogleConnect', () => {
  it('passes the return URL through and yields the consent URL', async () => {
    invoke.mockResolvedValue({ data: { auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }, error: null })

    const url = await startGoogleConnect('https://app.example.com/settings')

    expect(url).toContain('accounts.google.com')
    expect(invoke).toHaveBeenCalledWith('google-search-console', {
      body: { action: 'auth_url', redirect_to: 'https://app.example.com/settings' },
    })
  })
})

describe('listProperties', () => {
  it('returns the properties the Edge Function reports', async () => {
    invoke.mockResolvedValue({
      data: { properties: [{ id: '1', property_url: 'sc-domain:a.com' }, { id: '2', property_url: 'https://b.com/' }] },
      error: null,
    })
    expect(await listProperties()).toHaveLength(2)
  })

  it('treats an absent list as empty rather than failing', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })
    expect(await listProperties()).toEqual([])
  })
})

describe('syncSearchConsole', () => {
  it('sends the selected range', async () => {
    invoke.mockResolvedValue({ data: { status: 'completed', rows_imported: 1200 }, error: null })

    const result = await syncSearchConsole('project-1', '3m')

    expect(result.rows_imported).toBe(1200)
    expect(invoke).toHaveBeenCalledWith('google-search-console', {
      body: { action: 'sync', project_id: 'project-1', range: '3m', dimensions: undefined },
    })
  })

  it('raises a failed run as an error carrying the reason', async () => {
    invoke.mockResolvedValue({
      data: { status: 'failed', error: 'raw', reason: 'search_analytics_failed' },
      error: null,
    })
    await expect(syncSearchConsole('project-1', '28d')).rejects.toThrow(/Search Console refused the data request/i)
  })
})

describe('disconnectGoogle', () => {
  it('asks the server to drop the stored credential', async () => {
    invoke.mockResolvedValue({ data: { connected: false }, error: null })
    await disconnectGoogle()
    expect(invoke).toHaveBeenCalledWith('google-search-console', { body: { action: 'disconnect' } })
  })
})
