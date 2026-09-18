import * as React from 'react'
import { Bot, Loader2, PlugZap, Send, User } from 'lucide-react'
import { askAiAssistant } from '@/lib/edgeFunctions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

const SUGGESTIONS = [
  'Quali 10 parole chiave hanno più potenziale in questo momento?',
  'Quali pagine dovrei ottimizzare per prime?',
  'Perché il traffico potrebbe essere cambiato di recente?',
  'Quali contenuti dovrei creare adesso?',
]

export function AiAssistantCard({ projectId }: { projectId: string }) {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [configured, setConfigured] = React.useState<boolean | null>(null)

  async function send(question: string) {
    if (!question.trim()) return
    setMessages((prev) => [...prev, { role: 'user', text: question }])
    setInput('')
    setSending(true)
    const { configured: isConfigured, answer, error } = await askAiAssistant(projectId, question)
    setConfigured(isConfigured)
    setSending(false)
    if (!isConfigured) return
    setMessages((prev) => [...prev, { role: 'assistant', text: error ? `Errore: ${error}` : answer ?? '' }])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bot className="size-4" /> Assistente SEO AI
        </CardTitle>
        <CardDescription>Fai domande sul tuo progetto — le risposte si basano solo sui dati reali del progetto.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured === false ? (
          <EmptyState
            icon={<PlugZap className="size-5" />}
            title="Assistente AI non configurato"
            description="Imposta la variabile segreta AI_API_KEY sulle tue Edge Functions Supabase per attivare l'Assistente SEO AI."
          />
        ) : (
          <>
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.length > 0 && (
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {messages.map((m, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                      {m.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{m.text}</p>
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Sto pensando…
                  </div>
                )}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Fai una domanda sulle performance SEO…" />
              <Button type="submit" variant="accent" size="icon" disabled={sending}>
                <Send className="size-4" />
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}
