import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import Dashboard from '@/pages/Dashboard'
import Projects from '@/pages/Projects'
import Settings from '@/pages/Settings'
import NotFound from '@/pages/NotFound'
import ProjectOverview from '@/pages/project/ProjectOverview'
import SiteAudit from '@/pages/project/SiteAudit'
import RankTracking from '@/pages/project/RankTracking'
import Keywords from '@/pages/project/Keywords'
import Competitors from '@/pages/project/Competitors'
import Backlinks from '@/pages/project/Backlinks'
import Traffic from '@/pages/project/Traffic'
import Pages from '@/pages/project/Pages'
import PageDetail from '@/pages/project/PageDetail'
import Opportunities from '@/pages/project/Opportunities'
import Reports from '@/pages/project/Reports'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectOverview />} />
            <Route path="/projects/:id/audit" element={<SiteAudit />} />
            <Route path="/projects/:id/rankings" element={<RankTracking />} />
            <Route path="/projects/:id/keywords" element={<Keywords />} />
            <Route path="/projects/:id/competitors" element={<Competitors />} />
            <Route path="/projects/:id/backlinks" element={<Backlinks />} />
            <Route path="/projects/:id/traffic" element={<Traffic />} />
            <Route path="/projects/:id/pages" element={<Pages />} />
            <Route path="/projects/:id/pages/:pageId" element={<PageDetail />} />
            <Route path="/projects/:id/opportunities" element={<Opportunities />} />
            <Route path="/projects/:id/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
