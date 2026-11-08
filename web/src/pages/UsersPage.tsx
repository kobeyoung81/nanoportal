import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { StatusBadge } from '../components/ui/status-badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Pagination } from '../components/ui/pagination'
import { useApi } from '../hooks/useApi'
import { useDebounce } from '../hooks/useDebounce'
import type { UserSummary } from '../lib/api'

const PAGE_SIZE = 12

export function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showDeleted, setShowDeleted] = useState(false)
  const { data, loading, error, refetch } = useApi<UserSummary[]>(
    `/users${showDeleted ? '?include_deleted=true' : ''}`,
  )

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 250)

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    return (data ?? []).filter((user) => {
      if (
        query &&
        !user.user_id.toLowerCase().includes(query) &&
        !(user.display_name ?? '').toLowerCase().includes(query)
      ) {
        return false
      }
      if (statusFilter !== 'all' && user.agent_status !== statusFilter) {
        return false
      }
      if (tierFilter !== 'all' && user.tier !== tierFilter) {
        return false
      }
      return true
    })
  }, [data, debouncedSearch, statusFilter, tierFilter])

  const tiers = useMemo(() => Array.from(new Set((data ?? []).map((user) => user.tier))).sort(), [data])
  const statuses = useMemo(() => Array.from(new Set((data ?? []).map((user) => user.agent_status))).sort(), [data])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const resetPage = () => setPage(1)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.users')}
        subtitle={t('users.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowDeleted((value) => !value)}>
              {showDeleted ? t('agent.hideDeleted') : t('agent.showDeleted')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetch()
                toast.success(t('users.refreshed'))
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  resetPage()
                }}
                placeholder={t('users.searchPlaceholder')}
                className="pl-8"
              />
            </div>
            <div className="flex gap-3">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value)
                  resetPage()
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('users.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('users.allStatuses')}</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`enums.status.${status}`, { defaultValue: status })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tierFilter}
                onValueChange={(value) => {
                  setTierFilter(value)
                  resetPage()
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('users.tier')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('users.allTiers')}</SelectItem>
                  {tiers.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title={t('users.noMatchTitle')}
              description={t('users.noMatchDescription')}
              className="py-10"
            />
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('users.user')}</TableHead>
                  <TableHead>{t('userDetail.role')}</TableHead>
                  <TableHead>{t('users.tier')}</TableHead>
                  <TableHead>{t('users.status')}</TableHead>
                  <TableHead>{t('users.channels')}</TableHead>
                  <TableHead>{t('account.lastActivity')}</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((user) => (
                  <TableRow
                    key={user.user_id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/users/${user.user_id}`)}
                  >
                    <TableCell label={t('users.user')} className="font-medium">
                      <span className="flex items-center gap-2">
                        <span>{user.display_name || user.user_id}</span>
                        {user.auth_source === 'ldap' ? (
                          <Badge variant="outline" className="shrink-0">
                            {t('users.directory')}
                          </Badge>
                        ) : null}
                      </span>
                      {user.display_name ? (
                        <span className="block text-xs font-normal text-muted-foreground">{user.user_id}</span>
                      ) : null}
                    </TableCell>
                    <TableCell label={t('userDetail.role')} className="text-muted-foreground">
                      {t(`enums.role.${user.role}`, { defaultValue: user.role })}
                    </TableCell>
                    <TableCell label={t('users.tier')} className="text-muted-foreground">
                      {user.tier}
                    </TableCell>
                    <TableCell label={t('users.status')}>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell label={t('users.channels')} className="text-muted-foreground">
                      {(user.channels ?? []).join(', ') || '—'}
                    </TableCell>
                    <TableCell label={t('account.lastActivity')} className="text-muted-foreground">
                      {user.last_activity_at || t('common.na')}
                    </TableCell>
                    <TableCell label={t('account.actions')} className="text-right">
                      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination
            page={currentPage}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  )
}
