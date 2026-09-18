import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <h1 className="text-2xl font-semibold">Pagina non trovata</h1>
      <p className="text-sm text-muted-foreground">La pagina che stai cercando non esiste o è stata spostata.</p>
      <Button asChild variant="accent">
        <Link to="/dashboard">Torna alla dashboard</Link>
      </Button>
    </div>
  )
}
