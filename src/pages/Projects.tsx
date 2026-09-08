import { Link, useNavigate } from 'react-router-dom'
import { Globe, MoreVertical, Trash2 } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { NewProjectForm } from '@/components/NewProjectForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

export default function Projects() {
  const { projects, loading, deleteProject } = useProjects()
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">Analyze a domain to create a new project.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Analyze a website</CardTitle>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading projects…</div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Globe className="size-5" />}
          title="Add your first website"
          description="Enter a domain above and click Analyze to create your first project and start the SEO audit."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="group relative">
              <button
                className="absolute inset-0 z-0"
                aria-label={`Open ${project.domain}`}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base font-semibold text-foreground">{project.domain}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {project.country} · {project.device} · created {formatDate(project.created_at)}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative z-10 size-7">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Delete project ${project.domain}? This removes all its data.`)) {
                          deleteProject(project.id)
                        }
                      }}
                    >
                      <Trash2 className="size-4" /> Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                <Link to={`/projects/${project.id}`} className="relative z-10 text-xs font-medium text-accent hover:underline">
                  Open dashboard →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
