import { useMemo, useState } from 'react'
import { Eye, RefreshCw, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent } from '../components/ui/card'
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
import type { ConversationDetail, ConversationSummary } from '../lib/api'
import {
  conversationListPath,
  displayLabel,
  emptyConversationFilters,
  hasFilters,
  type ConversationFilters,
} from '../lib/logQuery'

const PAGE_SIZE = 15

// formatSize renders the stored conversation size for the list column.
function formatSize(bytes: number): string {
  if (!bytes) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ConversationLogsPage() {
  const { t } = useTranslation()
  // One control per condition; the bus filters, so a name reaches conversations
  // older than the last page of rows this table used to load.
  const [filters, setFilters] = useState<ConversationFilters>(emptyConversationFilters)
  const debounced = useDebounce(filters, 250)
  const { data, loading, error, refetch } = useApi<ConversationSummary[]>(conversationListPath(debounced))
  // The dropdown options come from an unfiltered read, so choosing a filter does
  // not shrink the list of choices to the rows that already matched.
  const facets = useApi<ConversationSummary[]>(
    hasFilters(debounced) ? conversationListPath(emptyConversationFilters) : null,
  )
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ConversationSummary | null>(null)

  const detailPath = selected ? `/conversations/${encodeURIComponent(selected.id)}` : null
  const detailState = useApi<ConversationDetail>(detailPath)

  const optionRows = useMemo(() => facets.data ?? data ?? [], [facets.data, data])
  const channels = useMemo(() => Array.from(new Set(optionRows.map((item) => item.channel))).sort(), [optionRows])
  const statuses = useMemo(() => Array.from(new Set(optionRows.map((item) => item.status))).sort(), [optionRows])

  const rows = data ?? []
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const resetPage = () => setPage(1)
  const setFilter = (key: keyof ConversationFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    resetPage()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.conversationLogs')}
        subtitle={t('conversations.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch()
              toast.success(t('conversations.refreshed'))
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {/* One condition per control, as the log reads: the agent and the account
              are matched by name as well as id, the dropdowns are exact. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              value={filters.session}
              onChange={(event) => setFilter('session', event.target.value)}
              placeholder={t('conversations.sessionPlaceholder')}
              aria-label={t('conversations.sessionPlaceholder')}
            />
            <Input
              value={filters.agent}
              onChange={(event) => setFilter('agent', event.target.value)}
              placeholder={t('conversations.agentPlaceholder')}
              aria-label={t('conversations.agentPlaceholder')}
            />
            <Input
              value={filters.account}
              onChange={(event) => setFilter('account', event.target.value)}
              placeholder={t('conversations.accountPlaceholder')}
              aria-label={t('conversations.accountPlaceholder')}
            />
            <Select
              value={filters.channel || 'all'}
              onValueChange={(value) => setFilter('channel', value === 'all' ? '' : value)}
            >
              <SelectTrigger aria-label={t('conversations.channel')}>
                <SelectValue placeholder={t('conversations.channel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('conversations.allChannels')}</SelectItem>
                {channels.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {channel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.status || 'all'}
              onValueChange={(value) => setFilter('status', value === 'all' ? '' : value)}
            >
              <SelectTrigger aria-label={t('conversations.status')}>
                <SelectValue placeholder={t('conversations.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('conversations.allStatuses')}</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilters(filters) ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(emptyConversationFilters)
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
              title={t('conversations.noMatchTitle')}
              description={t('conversations.noMatchDescription')}
              className="py-10"
            />
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('conversations.session')}</TableHead>
                  <TableHead>{t('conversations.agent')}</TableHead>
                  <TableHead>{t('conversations.account')}</TableHead>
                  <TableHead>{t('conversations.channel')}</TableHead>
                  <TableHead>{t('conversations.status')}</TableHead>
                  <TableHead className="text-right">{t('conversations.messages')}</TableHead>
                  <TableHead className="text-right">{t('conversations.size')}</TableHead>
                  <TableHead className="text-right">{t('conversations.updatedAt')}</TableHead>
                  <TableHead className="w-16 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
                    <TableCell label={t('conversations.session')} className="font-mono text-xs">
                      {item.id}
                    </TableCell>
                    <TableCell label={t('conversations.agent')} className="text-muted-foreground">
                      {displayLabel(item.agent_name, item.agent_id)}
                      {item.agent_name ? <span className="ml-1 font-mono text-xs">{item.agent_id}</span> : null}
                    </TableCell>
                    <TableCell label={t('conversations.account')} className="text-muted-foreground">
                      {displayLabel(item.account_name, item.account_id || '—')}
                      {item.account_name && item.account_id ? (
                        <span className="ml-1 font-mono text-xs">{item.account_id}</span>
                      ) : null}
                    </TableCell>
                    <TableCell label={t('conversations.channel')} className="text-muted-foreground">
                      {item.channel}
                    </TableCell>
                    <TableCell label={t('conversations.status')} className="text-muted-foreground">
                      {item.status}
                    </TableCell>
                    <TableCell label={t('conversations.messages')} className="text-right text-muted-foreground">
                      {item.message_count}
                    </TableCell>
                    <TableCell label={t('conversations.size')} className="text-right text-muted-foreground">
                      {formatSize(item.messages_bytes)}
                    </TableCell>
                    <TableCell label={t('conversations.updatedAt')} className="text-right text-xs text-muted-foreground">
                      {item.updated_at || t('common.na')}
                    </TableCell>
                    <TableCell label={t('account.actions')} className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('conversations.view')}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('conversations.view')}</TooltipContent>
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selected?.id}</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.agent_id} · ${selected.account_id || t('common.none')} · ${selected.channel} · ${selected.message_count} ${t('conversations.messages').toLowerCase()}`
                : t('conversations.detailTitle')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[28rem] overflow-auto">
            {detailState.loading ? (
              <Skeleton className="h-40 w-full" />
            ) : detailState.data ? (
              <div className="flex flex-col gap-4">
                {detailState.data.summary ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t('conversations.summaryLabel')}</p>
                    <p className="text-sm">{detailState.data.summary}</p>
                  </div>
                ) : null}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t('conversations.messagesTitle')}</p>
                  {detailState.data.messages ? (
                    <JsonView value={detailState.data.messages as Record<string, unknown>} />
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t('conversations.noMessages')}</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
