import { useTranslation } from 'react-i18next'
import { User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AdminIdentity } from '../lib/api'
import { Badge } from './ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Skeleton } from './ui/skeleton'

export function IdentityMenu({
  identity,
  onSignOut,
  showMyAccount = false,
}: {
  identity?: AdminIdentity | null
  onSignOut: () => void
  showMyAccount?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (!identity) {
    return (
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {identity.display_name?.slice(0, 2).toUpperCase() ?? 'NA'}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-xs font-medium">{identity.display_name ?? t('identity.portalAdmin')}</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('identity.signedInAs')}</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <p className="text-sm font-medium">{identity.display_name}</p>
        </div>
        <DropdownMenuSeparator />
        {showMyAccount ? (
          <>
            <DropdownMenuItem onSelect={() => navigate('/me')}>
              <User className="h-4 w-4" />
              {t('nav.myAccount')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>{t('identity.role')}</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <Badge variant={identity.role === 'admin' ? 'default' : identity.role === 'operator' ? 'info' : 'secondary'}>
            {t(`enums.role.${identity.role}`, { defaultValue: identity.role })}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="text-destructive">
          {t('identity.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
