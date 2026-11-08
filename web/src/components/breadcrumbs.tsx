import { useContext, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CrumbLabelContext, type CrumbLabel } from '../lib/crumbLabel'
import { breadcrumbsForPath, withCrumbOverride } from '../lib/navigation'

// CrumbLabelProvider carries the name a page resolved up to the breadcrumb in
// the header (see useCrumbLabel). It owns only that one value; the crumbs
// themselves stay URL-derived.
function CrumbLabelProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<CrumbLabel | null>(null)

  return <CrumbLabelContext.Provider value={{ value, setValue }}>{children}</CrumbLabelContext.Provider>
}

function Breadcrumbs() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { value } = useContext(CrumbLabelContext)
  const crumbs = withCrumbOverride(breadcrumbsForPath(pathname), pathname, value)

  return (
    <nav aria-label={t('nav.breadcrumb')} className="flex min-w-0 items-center gap-1 overflow-hidden text-sm">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        const text = crumb.labelKey ? t(crumb.labelKey) : (crumb.label ?? '')
        return (
          <span key={index} className="flex min-w-0 items-center gap-1" title={crumb.title}>
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                className="truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {text}
              </Link>
            ) : (
              <span className={`truncate ${isLast ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {text}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export { Breadcrumbs, CrumbLabelProvider }
