import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { UserLayout } from './components/UserLayout'
import { RequireAuth } from './components/RequireAuth'
import { Spinner } from './components/ui/spinner'
import { useTranslation } from 'react-i18next'
import { PluginPage } from './portal/PluginPage'
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
      {/* The auth module owns its three screens. There is no shell copy: a second
          implementation of the same screen meant every fix had to be made twice,
          and the copy had already drifted. Without the plugin the route reports
          itself unavailable. */}
      <Route path="/login" element={<PluginPage />} />
      <Route path="/register" element={<PluginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <PluginPage />
          </RequireAuth>
        }
      />

      {/* Standalone file preview opened in its own browser tab. Deliberately
          outside UserLayout: it fills the viewport and has no app chrome. */}
      <Route
        path="/files/view"
        element={
          <RequireAuth>
            <PluginPage />
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
        {/* The chat workbench is the workspace module's page: the agent list, the
            conversation tabs, the composer, the terminal and the file browser all
            live there. There is deliberately no shell copy: keeping one meant two
            implementations of the same screen, and the copy had already drifted.
            Without the plugin the page reports itself unavailable. */}
        <Route path="/agent" element={<PluginPage />} />
        {/* Legacy URLs for the workbench's user-config panel (it has no route of
            its own; both stay as shims for bookmarks). */}
        <Route path="/agent-config" element={<Navigate to="/agent" replace />} />
        <Route path="/user-config" element={<Navigate to="/agent" replace />} />
        {/* The account page is the auth module's (it ships at /plugins/auth/).
            No shell fallback: the shell renders the "module unavailable" state. */}
        <Route path="/me" element={<PluginPage />} />
        {/* Files are the workspace module's page (it ships at
            /plugins/workspace/); the shell keeps no copy of the browser. */}
        <Route path="/files" element={<PluginPage />} />
        {/* The long-running goals panel: a page the workspace module owns, so
            the shell only names the route (no copy of the screen here). */}
        <Route path="/tasks" element={<PluginPage />} />
        {/* The library is its own front end, served by nanoartifacts. The plugin
            claims the path; the shell only frames the route. */}
        <Route
          path="/artifacts/*"
          element={<PluginPage />}
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
