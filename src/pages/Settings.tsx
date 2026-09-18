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
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
import { formatDate } from '@/lib/utils'

export default function Settings() {
  const { user, signOut } = useAuth()
  const { projects } = useProjects()
  const { theme, setTheme } = useTheme()
  const [seoConfigured, setSeoConfigured] = React.useState<boolean | null>(null)
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null)
  const [crawlerDeployed, setCrawlerDeployed] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    checkProviderConfigured().then(setSeoConfigured)
    supabase.functions
      .invoke<{ configured: boolean }>('ai-assistant', { body: { action: 'status' } })
      .then(({ data }) => setAiConfigured(data?.configured ?? false))
    supabase.functions
      .invoke<{ configured: boolean }>('crawl-site', { body: { action: 'status' } })
      .then(({ data }) => setCrawlerDeployed(data?.configured ?? false))
  }, [])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Impostazioni</h1>
        <p className="text-sm text-muted-foreground">Account e stato delle integrazioni.</p>
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
            <span className="text-muted-foreground">Progetti</span>
            <span className="font-medium text-foreground">{projects.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Aspetto</span>
            <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Sistema</SelectItem>
                <SelectItem value="light">Chiaro</SelectItem>
                <SelectItem value="dark">Scuro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            Esci
          </Button>
        </CardContent>
      </Card>

      <GoogleConnectionCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Integrazioni</CardTitle>
          <CardDescription>Configurate tramite variabili segrete lato server sulle tue Edge Functions Supabase — mai esposte al browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <IntegrationRow
            name="Provider dati SEO"
            description="Alimenta parole chiave, posizionamento, concorrenti, backlink e stime di traffico. Imposta SEO_API_URL e SEO_API_KEY."
            configured={seoConfigured}
          />
          <IntegrationRow
            name="Assistente SEO AI"
            description="Risponde alle domande basandosi solo sui dati del tuo progetto. Imposta AI_API_KEY (Anthropic Messages API)."
            configured={aiConfigured}
          />
          <IntegrationRow
            name="Crawler di controllo del sito"
            description="Integrato — non richiede una API key, ma la Edge Function crawl-site deve essere distribuita sul tuo progetto Supabase."
            configured={crawlerDeployed}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">I tuoi progetti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun progetto ancora.</p>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                <span className="font-medium text-foreground">{p.domain}</span>
                <span className="text-xs text-muted-foreground">creato il {formatDate(p.created_at)}</span>
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
        <Badge variant="outline">Verifica…</Badge>
      ) : configured ? (
        <Badge variant="success">
          <CheckCircle2 className="size-3" /> Connesso
        </Badge>
      ) : (
        <Badge variant="outline">
          <XCircle className="size-3" /> Non connesso
        </Badge>
      )}
    </div>
  )
}
