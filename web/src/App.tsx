import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { UserLayout } from './components/UserLayout'
import { RequireAuth } from './components/RequireAuth'
import { Spinner } from './components/ui/spinner'
import { useTranslation } from 'react-i18next'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { AgentPage } from './pages/AgentPage'
import { MyAccountPage } from './pages/account/MyAccountPage'
import { FilesPage } from './pages/FilesPage'
import { ArtifactsPage } from './pages/ArtifactsPage'
import { PluginPage } from './portal/PluginPage'
import { FileViewerPage } from './pages/FileViewerPage'
import { SessionRefresher } from './components/session-refresher'

// The admin portal is a separate route-level chunk so the general-user surface
// stays small and fast.
const AdminLayout = lazy(() => import('./components/AdminLayout'))

function AdminFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label={t('nav.loadingAdmin')} />
    </div>
  )
}

// RedirectWithParams redirects to an /admin path, substituting the current
// route params. React Router's <Navigate> does not interpolate ":param" tokens,
// so legacy top-level URLs need this to avoid literal ":id"/":type" paths.
function RedirectWithParams({ to }: { to: (params: Record<string, string | undefined>) => string }) {
  const params = useParams()
  return <Navigate to={to(params)} replace />
}

function App() {
  return (
    <>
      {/* Keeps the session alive across all authenticated surfaces. */}
      <SessionRefresher />
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />

      {/* Standalone file preview opened in its own browser tab. Deliberately
          outside UserLayout: it fills the viewport and has no app chrome. */}
      <Route
        path="/files/view"
        element={
          <RequireAuth>
            <FileViewerPage />
          </RequireAuth>
        }
      />

      {/* General-user surface: agent-first, no sidebar. */}
      <Route
        element={
          <RequireAuth>
            <UserLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/agent" replace />} />
        <Route path="/agent" element={<AgentPage />} />
        {/* Legacy URLs for the workbench's user-config panel (it has no route of
            its own; both stay as shims for bookmarks). */}
        <Route path="/agent-config" element={<Navigate to="/agent" replace />} />
        <Route path="/user-config" element={<Navigate to="/agent" replace />} />
        {/* The account page is the auth module's (it ships at /plugins/auth/); the
            shell's own page is the fallback when that plugin is not installed. */}
        <Route path="/me" element={<PluginPage fallback={<MyAccountPage />} />} />
        <Route path="/files" element={<FilesPage variant="self" />} />
        {/* The library is its own front end. A plugin may own this route (the
            design's artifacts-ui); until it does — or if it is removed from the
            manifest — the shell's own framed page renders, so turning the
            plugin off is a manifest change rather than a code change. */}
        <Route
          path="/artifacts/*"
          element={<PluginPage fallback={<ArtifactsPage />} />}
        />
      </Route>

      {/* Admin portal: lazy-loaded, reached via the "Admin Panel" button. */}
      <Route
        path="/admin/*"
        element={
          <RequireAuth>
            <Suspense fallback={<AdminFallback />}>
              <AdminLayout />
            </Suspense>
          </RequireAuth>
        }
      />

      {/* Legacy admin paths redirect into the admin portal. */}
      <Route path="/overview" element={<Navigate to="/admin/overview" replace />} />
      <Route path="/components" element={<Navigate to="/admin/components" replace />} />
      <Route path="/components/:type" element={<RedirectWithParams to={(p) => `/admin/components/${p.type}`} />} />
      <Route path="/users" element={<Navigate to="/admin/users" replace />} />
      <Route path="/users/:id" element={<RedirectWithParams to={(p) => `/admin/users/${p.id}`} />} />
      <Route path="/users/agents/:id" element={<Navigate to="/admin/users" replace />} />
      <Route path="/configs" element={<Navigate to="/admin/configs" replace />} />
      <Route path="/audit" element={<Navigate to="/admin/audit" replace />} />
      <Route path="/alerts" element={<Navigate to="/admin/alerts" replace />} />

      <Route path="*" element={<Navigate to="/agent" replace />} />
      </Routes>
    </>
  )
}

export default App
