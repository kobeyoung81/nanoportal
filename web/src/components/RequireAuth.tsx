import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession } from '../lib/auth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const session = getSession()

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (session.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <>{children}</>
}
