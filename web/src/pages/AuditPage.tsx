import { useMemo, useState } from 'react'
import { Eye, RefreshCw, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { JsonView } from '../components/JsonView'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Pagination } from '../components/ui/pagination'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useApi } from '../hooks/useApi'
import { useDebounce } from '../hooks/useDebounce'
import type { AuditEntry } from '../lib/api'
import { auditListPath, displayLabel, emptyAuditFilters, hasFilters, type AuditFilters } from '../lib/logQuery'

const PAGE_SIZE = 15

const ACTION_TONE: Record<string, 'info' | 'warning' | 'danger' | 'secondary'> = {
  'alert.create': 'info',
  'alert.delete': 'warning',
  'config.update': 'info',
  'agent.create': 'info',
  'agent.delete': 'danger',
  'user.update': 'warning',
}

export function AuditPage() {
  const { t } = useTranslation()
  // One control per condition, and the bus ANDs them: an actor box that also
  // matches resource ids made "why did this show up" unanswerable.
  const [filters, setFilters] = useState<AuditFilters>(emptyAuditFilters)
  const debounced = useDebounce(filters, 250)
  const { data, loading, error, refetch } = useApi<AuditEntry[]>(auditListPath(debounced))
  // Dropdown options come from an unfiltered read so a filter does not shrink the
  // list of choices to what already matched.
  const facets = useApi<AuditEntry[]>(hasFilters(debounced) ? auditListPath(emptyAuditFilters) : null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditEntry | null>(null)

  const optionRows = useMemo(() => facets.data ?? data ?? [], [facets.data, data])
  const actions = useMemo(() => Array.from(new Set(optionRows.map((entry) => entry.action))).sort(), [optionRows])
  const resourceTypes = useMemo(
    () => Array.from(new Set(optionRows.map((entry) => entry.resource_type))).sort(),
    [optionRows],
  )

  const rows = data ?? []
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const resetPage = () => setPage(1)
  const setFilter = (key: keyof AuditFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    resetPage()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.operationLogs')}
        subtitle={t('audit.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch()
              toast.success(t('audit.refreshed'))
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {/* One condition per control: the dropdowns are exact, the boxes match an
              id or the name behind it. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={filters.action || 'all'}
              onValueChange={(value) => setFilter('action', value === 'all' ? '' : value)}
            >
              <SelectTrigger aria-label={t('configs.action')}>
                <SelectValue placeholder={t('configs.action')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('audit.allActions')}</SelectItem>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={filters.actor}
              onChange={(event) => setFilter('actor', event.target.value)}
              placeholder={t('audit.actorPlaceholder')}
              aria-label={t('audit.actorPlaceholder')}
            />
            <Select
              value={filters.resourceType || 'all'}
              onValueChange={(value) => setFilter('resourceType', value === 'all' ? '' : value)}
            >
              <SelectTrigger aria-label={t('audit.resourceType')}>
                <SelectValue placeholder={t('audit.resourceType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('audit.allResourceTypes')}</SelectItem>
                {resourceTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={filters.resource}
              onChange={(event) => setFilter('resource', event.target.value)}
              placeholder={t('audit.resourcePlaceholder')}
              aria-label={t('audit.resourcePlaceholder')}
            />
          </div>

          {hasFilters(filters) ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(emptyAuditFilters)
                  resetPage()
                }}
              >
                <RotateCcw className="h-4 w-4" />
                {t('common.reset')}
              </Button>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {loading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title={t('audit.noMatchTitle')}
              description={t('audit.noMatchDescription')}
              className="py-10"
            />
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('configs.action')}</TableHead>
                  <TableHead>{t('configs.actor')}</TableHead>
                  <TableHead>{t('configs.resource')}</TableHead>
                  <TableHead>{t('audit.ip')}</TableHead>
                  <TableHead className="text-right">{t('configs.time')}</TableHead>
                  <TableHead className="w-16 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((entry) => (
                  <TableRow key={entry.id} className="cursor-pointer" onClick={() => setSelected(entry)}>
                    <TableCell label={t('configs.action')}>
                      <Badge variant={ACTION_TONE[entry.action] ?? 'secondary'}>{entry.action}</Badge>
                    </TableCell>
                    <TableCell label={t('configs.actor')} className="text-muted-foreground">
                      {entry.actor_name || entry.actor_id} <span className="text-xs">({t(`enums.role.${entry.actor_role}`, { defaultValue: entry.actor_role })})</span>
                    </TableCell>
                    <TableCell label={t('configs.resource')} className="text-xs">
                      <span className="text-muted-foreground">{entry.resource_type}:</span>{' '}
                      {displayLabel(entry.resource_name, entry.resource_id || '—')}
                      {entry.resource_name && entry.resource_id ? (
                        <span className="ml-1 font-mono text-xs text-muted-foreground">{entry.resource_id}</span>
                      ) : null}
                    </TableCell>
                    <TableCell label={t('audit.ip')} className="text-muted-foreground">
                      {entry.ip || '—'}
                    </TableCell>
                    <TableCell label={t('configs.time')} className="text-right text-xs text-muted-foreground">
                      {entry.created_at || t('common.na')}
                    </TableCell>
                    <TableCell label={t('account.actions')} className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('audit.viewEntry', { id: entry.id })}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('audit.viewEntryTitle')}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination
            page={currentPage}
            pageSize={PAGE_SIZE}
            total={rows.length}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected ? (
                <>
                  <Badge variant={ACTION_TONE[selected.action] ?? 'secondary'}>{selected.action}</Badge>
                  <span className="font-mono text-sm text-muted-foreground">#{selected.id}</span>
                </>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.actor_name || selected.actor_id} (${selected.actor_role}) · ${selected.resource_type}:${selected.resource_id} · ${selected.ip || t('audit.noIp')} · ${selected.created_at || t('common.na')}`
                : t('audit.entryDetail')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            {selected?.detail ? (
              <JsonView value={selected.detail} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('audit.noAdditionalDetail')}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
