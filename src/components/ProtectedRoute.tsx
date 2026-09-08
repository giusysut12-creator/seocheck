import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
