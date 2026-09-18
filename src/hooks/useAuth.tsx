import * as React from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  signUpWithPassword: (email: string, password: string, fullName?: string) => Promise<{ error: string | null }>
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

/**
 * Supabase Auth's own error messages come back in English regardless of the
 * app's language. The handful a user is likely to actually see get a plain
 * Italian translation; anything else falls back to the original message
 * rather than hiding it.
 */
function translateAuthError(message: string): string {
  const known: Record<string, string> = {
    'Invalid login credentials': 'Credenziali di accesso non valide.',
    'Email not confirmed': 'Email non confermata. Controlla la posta per il link di conferma.',
    'User already registered': 'Esiste già un account con questa email.',
    'Password should be at least 6 characters': 'La password deve contenere almeno 6 caratteri.',
    'Unable to validate email address: invalid format': 'Indirizzo email non valido.',
    'Signup requires a valid password': 'La registrazione richiede una password valida.',
    'For security purposes, you can only request this after 60 seconds.':
      'Per motivi di sicurezza, puoi richiederlo di nuovo solo dopo 60 secondi.',
  }
  return known[message] ?? message
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setLoading(false)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? translateAuthError(error.message) : null }
    },
    signUpWithPassword: async (email, password, fullName) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: fullName ? { full_name: fullName } : undefined },
      })
      return { error: error ? translateAuthError(error.message) : null }
    },
    signInWithMagicLink: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      })
      return { error: error ? translateAuthError(error.message) : null }
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
