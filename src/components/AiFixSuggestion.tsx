import * as React from 'react'
import { Check, Copy, Loader2, Sparkles, UploadCloud } from 'lucide-react'
import { suggestFix, type SuggestedFix } from '@/lib/edgeFunctions'
import { applyFix, previewFix, type FixPreview } from '@/lib/wordpress'
import { Button } from '@/components/ui/button'

/**
 * Turns a generic opportunity recommendation into the rewritten title and
 * meta description themselves — copyable, and publishable straight to
 * WordPress when the project has a connection.
 *
 * Generating never touches the site: it only reads what the crawler already
 * found. Publishing does write, and is gated behind its own explicit
 * confirmation showing which entity matched (see PublishToWordPress below),
 * because a wrong match on a live shop is expensive and not obviously
 * reversible.
 */
export function AiFixSuggestion({
  projectId,
  keyword,
  kind,
  headline,
  actions,
  page,
  pageCrawled,
  competingPages,
}: {
  projectId: string
  keyword: string
  kind: string
  headline: string
  actions: string[]
  page: string | null
  /**
   * Whether `page` has been crawled yet. Known upfront from the same lookup
   * that decides "Apri analisi pagina", so the card can say so before the
   * user spends a click (and an AI call) discovering it — the AI would
   * refuse to invent a rewrite for a page it has no facts about anyway.
   * Undefined when `page` is null, or the caller hasn't checked.
   */
  pageCrawled?: boolean
  /** For 'cannibalization': every page competing for the keyword. */
  competingPages?: { page: string; impressions: number; clicks: number; position: number | null }[]
}) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'done' | 'unconfigured' | 'error'>('idle')
  const [fix, setFix] = React.useState<SuggestedFix | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Trying anyway overrides the upfront "not crawled" notice — the crawl
  // coverage known here can be a step behind a scan that just finished.
  const [tryAnyway, setTryAnyway] = React.useState(false)

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

  if (state === 'idle' && page && pageCrawled === false && !tryAnyway) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Questa pagina non è ancora stata scansionata — avvia un controllo del sito per generare una correzione
          mirata su title, meta description e H1 reali.
        </p>
        <button
          type="button"
          onClick={() => setTryAnyway(true)}
          className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          Ho appena scansionato, prova comunque
        </button>
      </div>
    )
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
      {page && (fix!.title || fix!.metaDescription) ? (
        <PublishToWordPress
          projectId={projectId}
          pageUrl={page}
          title={fix!.title}
          metaDescription={fix!.metaDescription}
        />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Testo generato dall'AI da incollare tu stesso nel pannello del tuo sito.
        </p>
      )}
    </div>
  )
}

/**
 * Publishes an approved rewrite to the user's WordPress site.
 *
 * Deliberately two steps. The first only resolves which post, page or
 * product the URL matched and what it currently says; nothing is written
 * until the user has seen that and confirmed. This writes to a live shop,
 * where a wrong match is expensive and not obviously reversible, so the
 * confirmation is worth the extra click.
 */
function PublishToWordPress({
  projectId,
  pageUrl,
  title,
  metaDescription,
}: {
  projectId: string
  pageUrl: string
  title: string | null
  metaDescription: string | null
}) {
  const [state, setState] = React.useState<'idle' | 'checking' | 'confirm' | 'publishing' | 'done' | 'error'>('idle')
  const [preview, setPreview] = React.useState<FixPreview | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function check() {
    setState('checking')
    setError(null)
    try {
      setPreview(await previewFix(projectId, { pageUrl, title, metaDescription }))
      setState('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verifica non riuscita')
      setState('error')
    }
  }

  async function publish() {
    setState('publishing')
    setError(null)
    try {
      await applyFix(projectId, { pageUrl, title, metaDescription })
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pubblicazione non riuscita')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success">
        <Check className="size-3.5" /> Pubblicato su WordPress. Google lo rileverà alla prossima scansione del sito.
      </p>
    )
  }

  if (state === 'confirm' && preview) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-background/60 p-2.5">
        <p className="text-xs text-foreground">
          Trovato su WordPress: <strong className="font-medium">{preview.type}</strong> «{preview.postTitle}».
        </p>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>
            Titolo SEO attuale: {preview.currentTitle ? `«${preview.currentTitle}»` : 'non impostato (usa quello del prodotto)'}
          </p>
          <p>
            Meta description attuale:{' '}
            {preview.currentMetaDescription ? `«${preview.currentMetaDescription}»` : 'non impostata'}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Verranno sovrascritti solo questi due campi di Yoast. Il nome del prodotto e il contenuto della pagina non
          vengono toccati.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="accent" size="sm" onClick={publish} disabled={state !== 'confirm'}>
            <UploadCloud className="size-3.5" /> Conferma e pubblica
          </Button>
          <button
            type="button"
            onClick={() => setState('idle')}
            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            Annulla
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={check} disabled={state === 'checking' || state === 'publishing'}>
          {state === 'checking' || state === 'publishing' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UploadCloud className="size-3.5" />
          )}
          {state === 'publishing' ? 'Pubblicazione…' : 'Pubblica su WordPress'}
        </Button>
        <span className="text-[11px] text-muted-foreground">oppure copia i campi qui sopra a mano</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
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
