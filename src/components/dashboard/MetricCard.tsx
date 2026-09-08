import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Sparkline } from '@/components/dashboard/Sparkline'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatPercent } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: ReactNode
  change?: number | null
  sparkline?: number[]
  tooltip?: string
  suffix?: string
}

export function MetricCard({ label, value, change, sparkline, tooltip, suffix }: MetricCardProps) {
  const isPositive = (change ?? 0) >= 0
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3 text-muted-foreground/70" />
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-2xl font-semibold text-foreground">
              {value}
              {suffix && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span>}
            </div>
            {change !== undefined && change !== null && (
              <div className={cn('text-xs font-medium', isPositive ? 'text-success' : 'text-destructive')}>
                {formatPercent(change)} <span className="font-normal text-muted-foreground">vs previous period</span>
              </div>
            )}
          </div>
          {sparkline && sparkline.length > 1 && (
            <div className="w-20">
              <Sparkline data={sparkline} color={isPositive ? 'var(--color-success)' : 'var(--color-destructive)'} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
