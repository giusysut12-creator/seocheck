// Supabase Edge Function: google-oauth-callback
//
// Public redirect target for Google's OAuth consent flow. Google sends the
// browser here with ?code and ?state, so this endpoint cannot be protected by
// a JWT — deploy it with JWT verification DISABLED. It trusts nothing but the
// one-time `state` row created by google-search-console/auth_url, which is
// what binds the returned credential to the user who started the flow.
//
// The refresh token never leaves the server: it is written straight into
// search_console_connections (a table with RLS enabled and no policies, so it
// is unreachable through the Data API) and the browser is redirected back to
// the app with nothing but a success flag.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')

function redirect(to: string, params: Record<string, string>) {
  let url: URL
  try {
    url = new URL(to)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid redirect target' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (!state) {
    return new Response('Missing state parameter', { status: 400 })
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Consume the state immediately: it is single-use whether or not the rest
  // of the exchange succeeds.
  const { data: stateRow } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle()
  await db.from('oauth_states').delete().eq('state', state)

  if (!stateRow) {
    return new Response('This authorization link has expired. Start the connection again.', { status: 400 })
  }

  const redirectTo = stateRow.redirect_to as string

  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    return redirect(redirectTo, { google: 'error', reason: 'expired' })
  }
  if (oauthError) {
    return redirect(redirectTo, { google: 'error', reason: oauthError })
  }
  if (!code) {
    return redirect(redirectTo, { google: 'error', reason: 'missing_code' })
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return redirect(redirectTo, { google: 'error', reason: 'not_configured' })
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${SUPABASE_URL}/functions/v1/google-oauth-callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      console.error('Google token exchange failed', tokenRes.status, await tokenRes.text().catch(() => ''))
      return redirect(redirectTo, { google: 'error', reason: 'token_exchange_failed' })
    }

    const token = await tokenRes.json()
    if (!token.refresh_token) {
      // Google only returns a refresh token on first consent unless
      // prompt=consent is used; auth_url always sets it, so this means the
      // grant was reused in an unexpected way.
      return redirect(redirectTo, { google: 'error', reason: 'no_refresh_token' })
    }

    let googleEmail: string | null = null
    let googleAccountId: string | null = null
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (infoRes.ok) {
        const info = await infoRes.json()
        googleEmail = info.email ?? null
        googleAccountId = info.sub ?? null
      }
    } catch {
      // Identifying the account is a nicety for the UI, not a requirement.
    }

    await db.from('search_console_connections').upsert(
      {
        user_id: stateRow.user_id,
        refresh_token: token.refresh_token,
        scope: token.scope ?? null,
        google_email: googleEmail,
        google_account_id: googleAccountId,
      },
      { onConflict: 'user_id' },
    )

    return redirect(redirectTo, { google: 'connected' })
  } catch (err) {
    console.error('OAuth callback error', err)
    return redirect(redirectTo, { google: 'error', reason: 'unexpected' })
  }
})
