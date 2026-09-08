import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/hooks/useAuth'
import { ProjectsProvider } from '@/hooks/useProjects'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ProjectsProvider>
          <TooltipProvider delayDuration={200}>
            <App />
          </TooltipProvider>
        </ProjectsProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
