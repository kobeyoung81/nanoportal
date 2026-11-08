import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { StatusBadge } from '../components/ui/status-badge'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useApi } from '../hooks/useApi'
import type { RuntimeSnapshot } from '../lib/api'

export function RuntimeLogsPage() {
  const { t } = useTranslation()
  const { data, loading, error, refetch } = useApi<RuntimeSnapshot>('/runtime')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.runtimeLogs')}
        subtitle={t('runtime.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch()
              toast.success(t('runtime.refreshed'))
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('runtime.containers')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : data && data.containers.length > 0 ? (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('runtime.owner')}</TableHead>
                  <TableHead>{t('runtime.level')}</TableHead>
                  <TableHead>{t('runtime.runner')}</TableHead>
                  <TableHead>{t('runtime.status')}</TableHead>
                  <TableHead className="text-right">{t('runtime.updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.containers.map((container) => (
                  <TableRow key={container.user_id}>
                    <TableCell label={t('runtime.owner')} className="font-medium">
                      {container.user_id}
                    </TableCell>
                    <TableCell label={t('runtime.level')}>
                      <Badge variant="secondary">{container.level}</Badge>
                    </TableCell>
                    <TableCell label={t('runtime.runner')} className="font-mono text-xs text-muted-foreground">
                      {container.runner_id || '—'}
                    </TableCell>
                    <TableCell label={t('runtime.status')}>
                      <StatusBadge status={container.status} />
                    </TableCell>
                    <TableCell label={t('runtime.updatedAt')} className="text-right text-xs text-muted-foreground">
                      {container.updated_at || t('common.na')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title={t('runtime.noData')} className="py-8" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('runtime.agents')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : data && data.agents.length > 0 ? (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('runtime.agentId')}</TableHead>
                  <TableHead>{t('runtime.owner')}</TableHead>
                  <TableHead>{t('runtime.status')}</TableHead>
                  <TableHead className="text-right">{t('runtime.updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell label={t('runtime.agentId')} className="font-mono text-xs font-medium">
                      {agent.id}
                    </TableCell>
                    <TableCell label={t('runtime.owner')} className="text-muted-foreground">
                      {agent.user_id}
                    </TableCell>
                    <TableCell label={t('runtime.status')}>
                      <StatusBadge status={agent.status} />
                    </TableCell>
                    <TableCell label={t('runtime.updatedAt')} className="text-right text-xs text-muted-foreground">
                      {agent.updated_at || t('common.na')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title={t('runtime.noData')} className="py-8" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('runtime.runners')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : data && data.runners.length > 0 ? (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('runtime.runner')}</TableHead>
                  <TableHead>{t('runtime.host')}</TableHead>
                  <TableHead>{t('runtime.status')}</TableHead>
                  <TableHead className="text-right">{t('runtime.lastHeartbeat')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.runners.map((runner) => (
                  <TableRow key={runner.id}>
                    <TableCell label={t('runtime.runner')} className="font-mono text-xs font-medium">
                      {runner.id}
                    </TableCell>
                    <TableCell label={t('runtime.host')} className="text-muted-foreground">
                      {runner.hostname}
                    </TableCell>
                    <TableCell label={t('runtime.status')}>
                      <StatusBadge status={runner.status} />
                    </TableCell>
                    <TableCell label={t('runtime.lastHeartbeat')} className="text-right text-xs text-muted-foreground">
                      {runner.last_heartbeat || t('common.na')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title={t('runtime.noData')} className="py-8" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
