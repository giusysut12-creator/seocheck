import * as React from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { useTheme } from '@/hooks/useTheme'
import { supabase } from '@/lib/supabase'
import { checkProviderConfigured } from '@/lib/seo/seoApiProvider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'

export default function Settings() {
  const { user, signOut } = useAuth()
  const { projects } = useProjects()
  const { theme, setTheme } = useTheme()
  const [seoConfigured, setSeoConfigured] = React.useState<boolean | null>(null)
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    checkProviderConfigured().then(setSeoConfigured)
    supabase.functions
      .invoke<{ configured: boolean }>('ai-assistant', { body: { action: 'status' } })
      .then(({ data }) => setAiConfigured(data?.configured ?? false))
  }, [])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and integration status.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium text-foreground">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Projects</span>
            <span className="font-medium text-foreground">{projects.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Appearance</span>
            <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Integrations</CardTitle>
          <CardDescription>Configured via server-side secrets on your Supabase Edge Functions — never exposed to the browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <IntegrationRow
            name="SEO Data Provider"
            description="Powers keywords, rankings, competitors, backlinks, and traffic estimates. Set SEO_API_URL and SEO_API_KEY."
            configured={seoConfigured}
          />
          <IntegrationRow
            name="AI SEO Assistant"
            description="Answers questions grounded in your project's data. Set AI_API_KEY (Anthropic Messages API)."
            configured={aiConfigured}
          />
          <IntegrationRow name="Site Audit Crawler" description="Built-in — no configuration required." configured={true} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Your projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects yet.</p>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                <span className="font-medium text-foreground">{p.domain}</span>
                <span className="text-xs text-muted-foreground">created {formatDate(p.created_at)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationRow({ name, description, configured }: { name: string; description: string; configured: boolean | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {configured === null ? (
        <Badge variant="outline">Checking…</Badge>
      ) : configured ? (
        <Badge variant="success">
          <CheckCircle2 className="size-3" /> Connected
        </Badge>
      ) : (
        <Badge variant="outline">
          <XCircle className="size-3" /> Not connected
        </Badge>
      )}
    </div>
  )
}
