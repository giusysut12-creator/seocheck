import { PlugZap } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

/**
 * Shown where a feature genuinely needs data this app cannot get for free.
 *
 * `alternative` is for the cases where it can: a shop owner reading "connect
 * a paid provider" concludes the feature does not exist, so wherever Search
 * Console already holds the answer, the notice says so instead of quoting a
 * price. Competitors' rankings and backlink graphs are not in Search
 * Console and no wording changes that.
 */
export function ProviderNotConfigured({ feature, alternative }: { feature: string; alternative?: string }) {
  return (
    <EmptyState
      icon={<PlugZap className="size-5" />}
      title="Provider dati SEO non connesso"
      description={
        `Questi dati vengono da un servizio esterno a pagamento, che non è collegato: ${feature}. ` +
        (alternative ? `${alternative} ` : '') +
        'Per collegarlo servono le variabili SEO_API_URL e SEO_API_KEY nelle impostazioni segrete di Supabase — trovi lo stato in Impostazioni. ' +
        'Finché non è collegato non viene mostrato nessun numero stimato: preferiamo dirti che il dato manca piuttosto che inventarlo.'
      }
    />
  )
}
