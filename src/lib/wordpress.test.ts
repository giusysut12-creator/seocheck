import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Edge Function is the boundary: these tests exercise the client's
// contract with it — argument shape and error translation — never a real
// WordPress site, and never assert that a password can be read back.
const invoke = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

const { connectWordPress, disconnectWordPress, getWordPressStatus } = await import('./wordpress')

beforeEach(() => invoke.mockReset())

describe('getWordPressStatus', () => {
  it('maps a connected project into the client shape', async () => {
    invoke.mockResolvedValue({
      data: {
        connected: true,
        site_url: 'https://shop.example.it',
        username: 'seo-check',
        seo_plugin: 'yoast',
        connected_at: '2026-01-01T00:00:00.000Z',
        last_verified_at: '2026-01-02T00:00:00.000Z',
      },
      error: null,
    })

    const status = await getWordPressStatus('project-1')

    expect(status).toEqual({
      connected: true,
      siteUrl: 'https://shop.example.it',
      username: 'seo-check',
      seoPlugin: 'yoast',
      connectedAt: '2026-01-01T00:00:00.000Z',
      lastVerifiedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(invoke).toHaveBeenCalledWith('wordpress-connect', {
      body: { action: 'status', project_id: 'project-1' },
    })
  })

  it('reports not connected without inventing a site', async () => {
    invoke.mockResolvedValue({ data: { connected: false }, error: null })

    const status = await getWordPressStatus('project-1')

    expect(status).toEqual({
      connected: false,
      siteUrl: null,
      username: null,
      seoPlugin: null,
      connectedAt: null,
      lastVerifiedAt: null,
    })
  })
})

describe('connectWordPress', () => {
  it('sends the credentials once and never asks for them again to report status', async () => {
    invoke.mockResolvedValue({
      data: { connected: true, site_url: 'https://shop.example.it', username: 'seo-check' },
      error: null,
    })

    await connectWordPress('project-1', {
      siteUrl: 'shop.example.it',
      username: 'seo-check',
      appPassword: 'abcd efgh ijkl mnop',
      seoPlugin: 'yoast',
    })

    expect(invoke).toHaveBeenCalledWith('wordpress-connect', {
      body: {
        action: 'connect',
        project_id: 'project-1',
        site_url: 'shop.example.it',
        username: 'seo-check',
        app_password: 'abcd efgh ijkl mnop',
        seo_plugin: 'yoast',
      },
    })
  })

  it('surfaces a rejected connection (e.g. wrong credentials) as a plain error', async () => {
    invoke.mockResolvedValue({
      data: { error: 'Nome utente o Password per le applicazioni non validi.', reason: 'invalid_credentials' },
      error: null,
    })

    await expect(
      connectWordPress('project-1', { siteUrl: 'x.it', username: 'u', appPassword: 'p', seoPlugin: 'yoast' }),
    ).rejects.toThrow(/non validi/)
  })

  it('reports a missing deployment rather than a silent failure', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })

    await expect(
      connectWordPress('project-1', { siteUrl: 'x.it', username: 'u', appPassword: 'p', seoPlugin: 'yoast' }),
    ).rejects.toThrow(/Edge Function "wordpress-connect"/)
  })
})

describe('disconnectWordPress', () => {
  it('asks the function to forget the connection for this project', async () => {
    invoke.mockResolvedValue({ data: { connected: false }, error: null })

    await disconnectWordPress('project-1')

    expect(invoke).toHaveBeenCalledWith('wordpress-connect', {
      body: { action: 'disconnect', project_id: 'project-1' },
    })
  })
})
