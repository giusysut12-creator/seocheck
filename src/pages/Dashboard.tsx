import { Navigate } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'

const LAST_PROJECT_KEY = 'rankpilot:last-project-id'

export default function Dashboard() {
  const { projects, loading } = useProjects()

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading your projects…</div>
  }

  if (projects.length === 0) {
    return <Navigate to="/projects" replace />
  }

  const lastId = localStorage.getItem(LAST_PROJECT_KEY)
  const target = projects.find((p) => p.id === lastId) ?? projects[0]

  return <Navigate to={`/projects/${target.id}`} replace />
}

export { LAST_PROJECT_KEY }
