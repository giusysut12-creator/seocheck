import * as React from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function Signup() {
  const { user, signUpWithPassword } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signUpError } = await signUpWithPassword(email, password, fullName)
    setSubmitting(false)
    if (signUpError) {
      setError(signUpError)
      return
    }
    setInfo('Account created. Check your inbox to confirm your email, then sign in.')
    setTimeout(() => navigate('/login'), 1800)
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
            <CardTitle className="text-foreground text-lg">Create your account</CardTitle>
            <CardDescription>Start analyzing your website's SEO in minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
              </div>
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
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {info && <p className="text-xs text-success">{info}</p>}
              <Button type="submit" variant="accent" className="w-full" disabled={submitting}>
                {submitting ? 'Creating account…' : 'Sign up'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
