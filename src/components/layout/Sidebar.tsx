import { NavLink, useParams } from 'react-router-dom'
import {
  LayoutDashboard,
  ScanSearch,
  LineChart,
  KeyRound,
  Users,
  Link2,
  TrendingUp,
  FileText,
  Sparkles,
  ClipboardList,
  Settings,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/lib/constants'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  audit: ScanSearch,
  rankings: LineChart,
  keywords: KeyRound,
  competitors: Users,
  backlinks: Link2,
  traffic: TrendingUp,
  pages: FileText,
  opportunities: Sparkles,
  reports: ClipboardList,
}

export function Sidebar() {
  const { id } = useParams<{ id: string }>()

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-accent">
          <Search className="size-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-white">RankPilot</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.key]
          const to = id ? `/projects/${id}/${item.path}` : '/dashboard'
          return (
            <NavLink
              key={item.key}
              to={to}
              end={item.path === ''}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-white/5 hover:text-white',
                  isActive && 'bg-accent/15 text-white',
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-white/5 hover:text-white',
              isActive && 'bg-accent/15 text-white',
            )
          }
        >
          <Settings className="size-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  )
}
