import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, LogOut, Plus, User as UserIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export function Topbar() {
  const { id } = useParams<{ id: string }>()
  const { projects } = useProjects()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const current = projects.find((p) => p.id === id)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <span className="max-w-[220px] truncate">{current ? current.domain : 'Select a project'}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Your projects</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">No projects yet.</div>
          )}
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
              {p.domain}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/projects')}>
            <Plus className="size-4" /> New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted">
              <UserIcon className="size-3.5" />
            </span>
            <span className="max-w-[160px] truncate text-xs text-muted-foreground">{user?.email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
