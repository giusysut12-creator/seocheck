import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface State {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            An unexpected error occurred. Try reloading the page — if the problem persists, contact support.
          </p>
          <Button variant="accent" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
