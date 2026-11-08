import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './lib/theme'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { Spinner } from './components/ui/spinner'
import { ErrorBoundary } from './components/ui/error-boundary'
import './index.css'
import './emoji-font.css'
import './i18n'
import { installGlobalGuards } from './lib/debug'
import { getSession } from './lib/auth'
import { adoptLegacyState, setCurrentUser } from './lib/clientState'

// Whose client state this tab reads is known before anything renders (RequireAuth
// gates on the same session), so the pre-namespace keys are adopted here — before
// a component can read a namespaced key and find nothing.
const bootSession = getSession()
if (bootSession) {
  adoptLegacyState(bootSession.user_id)
  setCurrentUser(bootSession.user_id)
}

installGlobalGuards()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="flex min-h-screen items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
