import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import CaseDetail from './pages/CaseDetail'
import Templates from './pages/Templates'
import Users from './pages/Users'
import Playbooks from './pages/Playbooks'
import PlaybookEditor from './pages/PlaybookEditor'
import EmailAnalysis from './pages/EmailAnalysis'
import KnowledgeBase from './pages/KnowledgeBase'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { token, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="h-screen bg-bg-primary flex items-center justify-center text-accent-muted text-sm">Chargement…</div>
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/playbooks" element={<Playbooks />} />
        <Route path="/playbooks/:id/edit" element={<PlaybookEditor />} />
        <Route path="/artifacts/email" element={<EmailAnalysis />} />
        <Route path="/knowledge" element={<KnowledgeBase />} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <Users />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
