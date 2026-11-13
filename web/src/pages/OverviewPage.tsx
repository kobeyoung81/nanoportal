import { useEffect } from 'react'
import {
  Boxes,
  Bot,
  Container,
  Inbox,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { MetricCard } from '../components/ui/metric-card'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { StatusBadge } from '../components/ui/status-badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { useApi } from '../hooks/useApi'
import { PORTAL_ADMIN_API_BASE, type Overview } from '../lib/api'

function useAutoRefresh(refetch: () => void, enabled: boolean, intervalMs: number) {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const id = setInterval(() => refetch(), intervalMs)
    return () => clearInterval(id)
  }, [refetch, enabled, intervalMs])
}

const HEALTH_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  offline: 'neutral',
}

export function OverviewPage() {
  const { t } = useTranslation()
  const { data, loading, error, refetch } = useApi<Overview>('/overview', PORTAL_ADMIN_API_BASE)

  useAutoRefresh(refetch, !error, 30000)

  const handleRefresh = () => {
    refetch()
    toast.success(t('overview.refreshed'))
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.overview')}
        subtitle={t('overview.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh}>
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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t('overview.systemHealth')}</CardTitle>
            <CardDescription>{t('overview.healthDescription')}</CardDescription>
          </div>
          {loading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <StatusBadge status={data?.system_health ?? 'unknown'} tone={data ? HEALTH_TONE[data.system_health] ?? 'neutral' : 'neutral'} />
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard icon={Users} label={t('overview.activeUsers')} value={data?.summary.active_users} loading={loading} />
            <MetricCard icon={Bot} label={t('overview.runningAgents')} value={data?.summary.running_agents} loading={loading} />
            <MetricCard icon={Inbox} label={t('overview.pendingInbound')} value={data?.summary.pending_inbound} loading={loading} />
            <MetricCard icon={Send} label={t('overview.pendingOutbound')} value={data?.summary.pending_outbound} loading={loading} />
            <MetricCard icon={Container} label={t('overview.activeContainers')} value={data?.summary.active_containers} loading={loading} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('overview.tierDistribution')}</CardTitle>
            <CardDescription>{t('overview.tierDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-6 w-full" />
                ))}
              </div>
            ) : data && Object.keys(data.tier_distribution).length > 0 ? (
              <TierBars distribution={data.tier_distribution} />
            ) : (
              <EmptyState title={t('overview.noTierData')} className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('overview.topAlerts')}</CardTitle>
            <CardDescription>{t('overview.alertsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : data && data.top_alerts.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {data.top_alerts.map((alert) => (
                  <li key={alert.rule_id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{alert.message}</p>
                      <p className="truncate text-xs text-muted-foreground">{alert.rule_id}</p>
                    </div>
                    <StatusBadge status={alert.severity} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Boxes} title={t('overview.noActiveAlerts')} description={t('overview.noActiveAlertsDescription')} className="py-10" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function TierBars({ distribution }: { distribution: Record<string, number> }) {
  const { t, i18n } = useTranslation()
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(([, count]) => count))
  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="flex flex-col gap-3">
      {entries.map(([tier, count]) => (
        <div key={tier} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">{tier}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80 transition-all"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
            {count}
          </span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        {t('overview.totals', { total: total.toLocaleString(i18n.language), tiers: entries.length })}
      </p>
    </div>
  )
}
