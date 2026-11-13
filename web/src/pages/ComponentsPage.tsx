import { useNavigate, useParams } from 'react-router-dom'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { StatusBadge, toneForStatus } from '../components/ui/status-badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useApi } from '../hooks/useApi'
import {
  PORTAL_ADMIN_API_BASE,
  deleteRunner,
  type ComponentDetail,
  type ComponentSummary,
  type RunnerSummary,
} from '../lib/api'

export function ComponentsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { type } = useParams<{ type: string }>()
  const listState = useApi<ComponentSummary[]>('/components', PORTAL_ADMIN_API_BASE)
  const detailPath = type ? `/components/${encodeURIComponent(type)}` : null
  const detailState = useApi<ComponentDetail>(detailPath, PORTAL_ADMIN_API_BASE)
  const runnersPath = type === 'runner' ? '/runners' : null
  const runnersState = useApi<RunnerSummary[]>(runnersPath, PORTAL_ADMIN_API_BASE)
  const [deleteTarget, setDeleteTarget] = useState<RunnerSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const handleRefresh = () => {
    listState.refetch()
    if (detailPath) {
      detailState.refetch()
    }
    if (runnersPath) {
      runnersState.refetch()
    }
    toast.success(t('components.refreshed'))
  }

  const handleDeleteRunner = async () => {
    if (!deleteTarget) {
      return
    }
    setDeleteBusy(true)
    try {
      await deleteRunner(deleteTarget.id)
      toast.success(t('components.runnerRemoved'))
      runnersState.refetch()
      listState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('components.removeRunnerFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.components')}
        subtitle={t('components.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      {listState.error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{listState.error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {listState.loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-3.5 w-40" />
                </CardHeader>
              </Card>
            ))
          : listState.data?.map((component) => (
              <button
                key={component.type}
                type="button"
                onClick={() => navigate(`/admin/components/${component.type}`)}
                className={`text-left transition-colors ${
                  type === component.type ? 'rounded-xl ring-2 ring-ring' : 'rounded-xl'
                }`}
              >
                <Card className="h-full hover:border-primary/40">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{component.display_name}</CardTitle>
                      <StatusBadge status={component.status} />
                    </div>
                    <CardDescription className="line-clamp-2">{component.detail}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-x-4 gap-y-1 pt-0">
                    {component.metrics.slice(0, 4).map((metric) => (
                      <span key={metric.label} className="text-xs text-muted-foreground">
                        {metric.label}: <strong className="font-medium text-foreground">{metric.value}</strong>
                      </span>
                    ))}
                  </CardContent>
                </Card>
              </button>
            ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{detailState.data?.display_name ?? t('components.detailTitle')}</CardTitle>
          <CardDescription>
            {detailState.loading
              ? t('common.loading')
              : detailState.error
                ? detailState.error
                : (detailState.data?.description ?? t('components.selectDetail'))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detailState.data ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={detailState.data.status} tone={toneForStatus(detailState.data.status)} />
                <span className="text-sm text-muted-foreground">
                  {t('components.configVersion')}: <strong className="font-medium text-foreground">{detailState.data.config_version || t('common.na')}</strong>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('account.updated')}: {detailState.data.updated_at || t('common.na')}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {detailState.data.metrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground">{metric.label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</p>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">{t('components.instances')}</h3>
                {detailState.data.instances.length === 0 ? (
                  <EmptyState title={t('components.noInstances')} description={t('components.noInstancesDescription')} className="py-8" />
                ) : (
                  <Table stacked>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('files.name')}</TableHead>
                        <TableHead>{t('account.status')}</TableHead>
                        <TableHead>{t('components.detail')}</TableHead>
                        <TableHead className="text-right">{t('components.lastSeen')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailState.data.instances.map((instance) => (
                        <TableRow key={instance.id}>
                          <TableCell label={t('files.name')} className="font-medium">
                            {instance.name}
                          </TableCell>
                          <TableCell label={t('account.status')}>
                            <StatusBadge status={instance.status} />
                          </TableCell>
                          <TableCell label={t('components.detail')} className="text-muted-foreground">
                            {instance.detail || '—'}
                          </TableCell>
                          <TableCell label={t('components.lastSeen')} className="text-right text-muted-foreground">
                            {instance.last_seen_at || t('common.na')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {type === 'runner' ? (
                <div>
                  <h3 className="mb-2 text-sm font-medium">{t('components.runners')}</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {t('components.runnersHint')}
                  </p>
                  {runnersState.loading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : runnersState.error ? (
                    <p className="text-sm text-destructive">{runnersState.error}</p>
                  ) : runnersState.data && runnersState.data.length > 0 ? (
                    <Table stacked>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('account.id')}</TableHead>
                          <TableHead>{t('components.hostname')}</TableHead>
                          <TableHead>{t('account.status')}</TableHead>
                          <TableHead>{t('components.lastHeartbeat')}</TableHead>
                          <TableHead>{t('components.registered')}</TableHead>
                          <TableHead className="text-right" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runnersState.data.map((runner) => (
                          <TableRow key={runner.id}>
                            <TableCell label={t('account.id')} className="font-mono text-xs font-medium">
                              {runner.id}
                            </TableCell>
                            <TableCell label={t('components.hostname')} className="text-muted-foreground">
                              {runner.hostname || '—'}
                            </TableCell>
                            <TableCell label={t('account.status')}>
                              <StatusBadge status={runner.status === 'online' ? 'healthy' : 'offline'} />
                            </TableCell>
                            <TableCell label={t('components.lastHeartbeat')} className="text-muted-foreground">
                              {runner.last_heartbeat || t('common.na')}
                            </TableCell>
                            <TableCell label={t('components.registered')} className="text-muted-foreground">
                              {runner.registered_at || t('common.na')}
                            </TableCell>
                            <TableCell label={t('account.actions')} className="text-right">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive"
                                    aria-label={t('components.removeNamedRunner', { id: runner.id })}
                                    onClick={() => setDeleteTarget(runner)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('components.removeRunner')}</TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyState title={t('components.noRunners')} description={t('components.noRunnersDescription')} className="py-8" />
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('components.removeNamedRunner', { id: deleteTarget?.id ?? '' })}
        description={t('components.removeRunnerDescription')}
        confirmLabel={t('components.remove')}
        busy={deleteBusy}
        onConfirm={handleDeleteRunner}
      />
    </div>
  )
}
