const CATEGORY_LABELS: Record<string, string> = {
  technical_score: 'Technical SEO',
  onpage_score: 'On-page SEO',
  performance_score: 'Performance',
  indexability_score: 'Indexability',
  content_score: 'Content',
  backlinks_score: 'Backlinks',
}

function scoreColor(score: number) {
  if (score >= 80) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-destructive)'
}

export function SeoScoreGauge({
  score,
  categories,
}: {
  score: number
  categories: Record<string, number | null>
}) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)
  const color = scoreColor(score)

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="relative mx-auto flex size-36 shrink-0 items-center justify-center">
        <svg viewBox="0 0 128 128" className="size-36 -rotate-90">
          <circle cx="64" cy="64" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="10" />
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-3xl font-bold text-foreground">{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
          const value = categories[key]
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{value ?? '—'}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${value ?? 0}%`, background: value !== null ? scoreColor(value ?? 0) : 'transparent' }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
