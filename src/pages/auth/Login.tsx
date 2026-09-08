import * as React from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function Login() {
  const { user, signInWithPassword, signInWithMagicLink } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [mode, setMode] = React.useState<'password' | 'magic'>('password')
  const [error, setError] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  if (user) {
    const from = (location.state as { from?: Location })?.from?.pathname || '/dashboard'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    if (mode === 'password') {
      const { error: signInError } = await signInWithPassword(email, password)
      setSubmitting(false)
      if (signInError) setError(signInError)
      else navigate('/dashboard')
    } else {
      const { error: linkError } = await signInWithMagicLink(email)
      setSubmitting(false)
      if (linkError) setError(linkError)
      else setInfo('Check your inbox for a magic sign-in link.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-accent">
            <Search className="size-4 text-white" />
          </div>
          <span className="text-lg font-semibold">RankPilot</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-lg">Sign in</CardTitle>
            <CardDescription>SEO Intelligence for your website</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              {mode === 'password' && (
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              {info && <p className="text-xs text-success">{info}</p>}
              <Button type="submit" variant="accent" className="w-full" disabled={submitting}>
                {submitting ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === 'password' ? 'magic' : 'password')}
              >
                {mode === 'password' ? 'Use a magic link instead' : 'Use email and password instead'}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link to="/signup" className="text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
