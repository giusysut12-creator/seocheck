import { PlugZap } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export function ProviderNotConfigured({ feature }: { feature: string }) {
  return (
    <EmptyState
      icon={<PlugZap className="size-5" />}
      title="Provider dati SEO non connesso"
      description={`Connetti un provider dati SEO per sbloccare ${feature}. Imposta SEO_API_URL e SEO_API_KEY nelle variabili segrete della tua Edge Function Supabase — vedi Impostazioni per lo stato. Nessun numero stimato viene mostrato finché un provider non è configurato.`}
    />
  )
}
