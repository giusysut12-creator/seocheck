import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COUNTRIES, SEARCH_ENGINES } from '@/lib/constants'
import { useProjects } from '@/hooks/useProjects'
import type { Device } from '@/lib/database.types'

export function NewProjectForm({ compact = false }: { compact?: boolean }) {
  const { createProject } = useProjects()
  const navigate = useNavigate()
  const [domain, setDomain] = React.useState('')
  const [country, setCountry] = React.useState('US')
  const [device, setDevice] = React.useState<Device>('desktop')
  const [searchEngine, setSearchEngine] = React.useState('google')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { project, error: createError } = await createProject({
      name: domain,
      domain,
      country,
      device,
      search_engine: searchEngine,
    })
    setSubmitting(false)
    if (createError) {
      setError(createError)
      return
    }
    if (project) navigate(`/projects/${project.id}`)
  }

  return (
    <form
      onSubmit={handleAnalyze}
      className={compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-3 sm:flex-row sm:items-center'}
    >
      <div className="relative flex-1 min-w-[220px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="pl-9"
          required
        />
      </div>
      <Select value={country} onValueChange={setCountry}>
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COUNTRIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={device} onValueChange={(v) => setDevice(v as Device)}>
        <SelectTrigger className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desktop">Desktop</SelectItem>
          <SelectItem value="mobile">Mobile</SelectItem>
        </SelectContent>
      </Select>
      <Select value={searchEngine} onValueChange={setSearchEngine}>
        <SelectTrigger className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEARCH_ENGINES.map((s) => (
            <SelectItem key={s.code} value={s.code}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" variant="accent" disabled={submitting}>
        {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
        Analyze
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  )
}
