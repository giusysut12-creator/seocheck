import { PlugZap } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export function ProviderNotConfigured({ feature }: { feature: string }) {
  return (
    <EmptyState
      icon={<PlugZap className="size-5" />}
      title="SEO data provider not connected"
      description={`Connect an SEO data provider to unlock ${feature}. Set SEO_API_URL and SEO_API_KEY in your Supabase Edge Function secrets — see Settings for status. No estimated numbers are shown until a provider is configured.`}
    />
  )
}
