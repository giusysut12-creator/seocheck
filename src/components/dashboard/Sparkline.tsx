import { Line, LineChart, ResponsiveContainer } from 'recharts'

export function Sparkline({ data, color = 'var(--color-accent)' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <div className="h-8 w-full" />
  const points = data.map((value, index) => ({ index, value }))
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
