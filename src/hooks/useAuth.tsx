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
      return { error: error?.message ?? null }
    },
    signUpWithPassword: async (email, password, fullName) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: fullName ? { full_name: fullName } : undefined },
      })
      return { error: error?.message ?? null }
    },
    signInWithMagicLink: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      })
      return { error: error?.message ?? null }
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
