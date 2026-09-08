import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center',
        className,
      )}
    >
      {icon && <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
