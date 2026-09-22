import * as React from 'react'
import { Check, Copy, Loader2, Sparkles } from 'lucide-react'
import { suggestFix, type SuggestedFix } from '@/lib/edgeFunctions'
import { Button } from '@/components/ui/button'

/**
 * Turns a generic opportunity recommendation into text the user can paste
 * straight into their own site. This never writes to the user's website —
 * it only returns text — because applying it automatically would need write
 * access to their CMS, which this app was never given and was not asked to
 * get: a wrong page match or a malformed write could damage a live page,
 * and that risk belongs to a separate, explicit integration, not a button
 * that fires on every opportunity card.
 */
export function AiFixSuggestion({
  projectId,
  keyword,
  kind,
  headline,
  actions,
  page,
  competingPages,
}: {
  projectId: string
  keyword: string
  kind: string
  headline: string
  actions: string[]
  page: string | null
  /** For 'cannibalization': every page competing for the keyword. */
  competingPages?: { page: string; impressions: number; clicks: number; position: number | null }[]
}) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'done' | 'unconfigured' | 'error'>('idle')
  const [fix, setFix] = React.useState<SuggestedFix | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function generate() {
    setState('loading')
    setError(null)
    const result = await suggestFix(projectId, { keyword, kind, headline, actions, page, competingPages })
    if (!result.configured) {
      setState('unconfigured')
      return
    }
    if (result.error || !result.fix) {
      setError(result.error ?? 'Nessuna correzione ricevuta.')
      setState('error')
      return
    }
    setFix(result.fix)
    setState('done')
  }

  if (state === 'idle' || state === 'loading') {
    return (
      <Button variant="outline" size="sm" onClick={generate} disabled={state === 'loading'}>
        {state === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        Genera correzione con AI
      </Button>
    )
  }

  if (state === 'unconfigured') {
    return (
      <p className="text-xs text-muted-foreground">
        Attiva l'Assistente SEO AI in Impostazioni per generare correzioni pronte da incollare.
      </p>
    )
  }

  if (state === 'error') {
    return (
      <div className="space-y-1">
        <p className="text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={generate}>
          <Sparkles className="size-3.5" /> Riprova
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-accent/30 bg-accent/5 p-3">
      {fix!.title && <CopyField label="Titolo suggerito" value={fix!.title} />}
      {fix!.metaDescription && <CopyField label="Meta description suggerita" value={fix!.metaDescription} />}
      {fix!.notes && <p className="text-xs text-muted-foreground">{fix!.notes}</p>}
      <p className="text-[11px] text-muted-foreground">
        Testo generato dall'AI da incollare tu stesso nel pannello del tuo sito — nulla viene modificato qui.
      </p>
    </div>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied by the browser; the text is still
      // selectable and readable, so nothing else needs to happen here.
    }
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-start justify-between gap-2">
        <p className="text-sm text-foreground">{value}</p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={copy}>
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiato' : 'Copia'}
        </Button>
      </div>
    </div>
  )
}
