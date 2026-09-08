import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { Device, Project } from '@/lib/database.types'
import { useAuth } from '@/hooks/useAuth'

interface NewProjectInput {
  name: string
  domain: string
  country: string
  device: Device
  search_engine: string
}

interface ProjectsContextValue {
  projects: Project[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createProject: (input: NewProjectInput) => Promise<{ project: Project | null; error: string | null }>
  deleteProject: (id: string) => Promise<{ error: string | null }>
}

const ProjectsContext = React.createContext<ProjectsContextValue | undefined>(undefined)

function normalizeDomain(raw: string): string {
  let domain = raw.trim().toLowerCase()
  domain = domain.replace(/^https?:\/\//, '')
  domain = domain.replace(/^www\./, '')
  domain = domain.replace(/\/.*$/, '')
  return domain
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [projects, setProjects] = React.useState<Project[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!user) {
      setProjects([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setProjects((data as Project[]) ?? [])
    }
    setLoading(false)
  }, [user])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const createProject = React.useCallback<ProjectsContextValue['createProject']>(
    async (input) => {
      if (!user) return { project: null, error: 'You must be signed in.' }
      const domain = normalizeDomain(input.domain)
      if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
        return { project: null, error: 'Enter a valid domain, e.g. example.com' }
      }
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: input.name || domain,
          domain,
          country: input.country,
          device: input.device,
          search_engine: input.search_engine,
        })
        .select('*')
        .single()
      if (insertError) return { project: null, error: insertError.message }
      const project = data as Project
      await supabase.from('domains').insert({ project_id: project.id, domain, is_primary: true })
      setProjects((prev) => [project, ...prev])
      return { project, error: null }
    },
    [user],
  )

  const deleteProject = React.useCallback<ProjectsContextValue['deleteProject']>(async (id) => {
    const { error: deleteError } = await supabase.from('projects').delete().eq('id', id)
    if (deleteError) return { error: deleteError.message }
    setProjects((prev) => prev.filter((p) => p.id !== id))
    return { error: null }
  }, [])

  const value: ProjectsContextValue = { projects, loading, error, refresh, createProject, deleteProject }

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const ctx = React.useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjects must be used within a ProjectsProvider')
  return ctx
}

export { normalizeDomain }
