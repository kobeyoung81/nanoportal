import { createContext, useContext, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// The name a page resolved for the breadcrumb's last crumb. It travels through
// context because the crumb lives in the admin shell while the data lives in
// the page, and the URL only carries the id. `path` is the route the name
// belongs to — see withCrumbOverride, which refuses a name from another route.
// No component lives in this module, so exporting a hook from it does not upset
// react-refresh (compare lib/theme.tsx, whose hook needed an allowlist entry).
export type CrumbLabel = { path: string; label: string; title?: string }

export const CrumbLabelContext = createContext<{
  value: CrumbLabel | null
  setValue: (value: CrumbLabel | null) => void
}>({ value: null, setValue: () => {} })

/**
 * Publishes an entity's display name to the breadcrumb. Pass null (or nothing)
 * while the name is unknown: the crumb then keeps what the URL implies. The
 * value is cleared on unmount, so the next page never inherits this one's name.
 */
export function useCrumbLabel(label: string | null | undefined, title?: string) {
  const { pathname } = useLocation()
  const { setValue } = useContext(CrumbLabelContext)

  useEffect(() => {
    setValue(label ? { path: pathname, label, title } : null)
    return () => setValue(null)
  }, [pathname, label, title, setValue])
}
