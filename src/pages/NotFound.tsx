import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist or was moved.</p>
      <Button asChild variant="accent">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  )
}
