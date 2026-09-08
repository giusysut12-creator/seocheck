import * as React from 'react'
import { useParams } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'

export function useCurrentProject() {
  const { id } = useParams<{ id: string }>()
  const { projects, loading } = useProjects()
  const project = React.useMemo(() => projects.find((p) => p.id === id) ?? null, [projects, id])
  return { project, loading, id }
}
