import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Container, FolderTree, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../components/page-header'
import { MetricCard } from '../../components/ui/metric-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { StatusBadge } from '../../components/ui/status-badge'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/confirm-dialog'
import { AgentFormDialog } from '../../components/agent-form-dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { useApi } from '../../hooks/useApi'
import { deleteAgent, restartAgent, restartMeContainer, restoreAgent, USER_API_BASE, type AgentDetail, type UserDetail } from '../../lib/api'

export function MyAccountPage() {
  const { t } = useTranslation()
  const detailState = useApi<UserDetail>('/me/detail', USER_API_BASE)
  const [showDeleted, setShowDeleted] = useState(false)
  const agentsState = useApi<AgentDetail[]>(`/me/agents${showDeleted ? '?include_deleted=true' : ''}`, USER_API_BASE)

  const [restartContainerBusy, setRestartContainerBusy] = useState(false)
  const [restartAgentBusy, setRestartAgentBusy] = useState<string | null>(null)
  const [restoreAgentBusy, setRestoreAgentBusy] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentDetail | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const me = detailState.data
  const agents = agentsState.data ?? []

  const handleRestartContainer = async () => {
    setRestartContainerBusy(true)
    try {
      await restartMeContainer()
      toast.success(t('account.containerRestartRequested'))
      detailState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('account.restartContainerFailed'))
    } finally {
      setRestartContainerBusy(false)
    }
  }

  const handleRestartAgent = async (agentID: string) => {
    setRestartAgentBusy(agentID)
    try {
      await restartAgent(agentID)
      toast.success(t('agent.restartRequested'))
      agentsState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.restartFailed'))
    } finally {
      setRestartAgentBusy(null)
    }
  }

  const handleDeleteAgent = async () => {
    if (!deleteTarget) {
      return
    }
    setDeleteBusy(true)
    try {
      await deleteAgent(deleteTarget.id)
      toast.success(t('agent.agentDeleted'))
      agentsState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.deleteAgentFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleRestoreAgent = async (agentID: string) => {
    setRestoreAgentBusy(agentID)
    try {
      await restoreAgent(agentID)
      toast.success(t('agent.agentRestored'))
      agentsState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.restoreAgentFailed'))
    } finally {
      setRestoreAgentBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.myAccount')}
        subtitle={t('account.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              detailState.refetch()
              agentsState.refetch()
              toast.success(t('common.refreshed'))
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      {detailState.error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{detailState.error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={Bot}
          label={t('agent.agents')}
          value={detailState.loading ? undefined : agents.length}
          loading={detailState.loading}
        />
        <MetricCard
          icon={Container}
          label={t('account.container')}
          value={me?.containers[0]?.status ?? t('common.na')}
          loading={detailState.loading}
        />
        <MetricCard
          icon={RefreshCw}
          label={t('account.lastActivity')}
          value={me?.last_activity_at ?? t('common.na')}
          loading={detailState.loading}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t('agent.agents')}</CardTitle>
            <CardDescription>{t('account.fleetDescription')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowDeleted((v) => !v)}>
              {showDeleted ? t('agent.hideDeleted') : t('agent.showDeleted')}
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('agent.newAgent')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {agentsState.loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : agentsState.error ? (
            <p className="py-8 text-center text-sm text-destructive">{agentsState.error}</p>
          ) : agents.length > 0 ? (
            <ul className="flex flex-col divide-y">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <div className="group flex items-center justify-between gap-3 rounded-md py-3 transition-colors hover:bg-muted/50">
                    <Link to={`/files?agent=${encodeURIComponent(agent.id)}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{agent.display_name || agent.id}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {agent.model || t('agent.defaultModel')} · {t('account.toolCount', { count: (agent.tools ?? []).length })}
                        </p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={agent.status} />
                      {agent.status === 'deleted' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={restoreAgentBusy === agent.id}
                          onClick={() => handleRestoreAgent(agent.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t('agent.restore')}
                        </Button>
                      ) : (
                      <div className="flex items-center">
                        {agent.status === 'running' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={t('account.restartNamed', { name: agent.display_name })}
                                disabled={restartAgentBusy === agent.id}
                                onClick={() => handleRestartAgent(agent.id)}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('account.restartAgent')}</TooltipContent>
                          </Tooltip>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t('account.openNamedFiles', { name: agent.display_name })}
                              asChild
                            >
                              <Link to={`/files?agent=${encodeURIComponent(agent.id)}`}>
                                <FolderTree className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('files.openFullPage')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t('account.editNamed', { name: agent.display_name })}
                              onClick={() => {
                                setEditingAgent(agent)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('account.editAgent')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              aria-label={t('account.deleteNamed', { name: agent.display_name })}
                              onClick={() => setDeleteTarget(agent)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('account.deleteAgent')}</TooltipContent>
                        </Tooltip>
                      </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Bot}
              title={t('agent.noAgentsTitle')}
              description={t('agent.noAgentsCreate')}
              action={
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t('agentForm.createAgent')}
                </Button>
              }
              className="py-8"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.container')}</CardTitle>
          <CardDescription>{t('account.containerDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {detailState.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : me && me.containers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('account.id')}</TableHead>
                  <TableHead>{t('account.level')}</TableHead>
                  <TableHead>{t('account.status')}</TableHead>
                  <TableHead className="text-right">{t('account.updated')}</TableHead>
                  <TableHead className="text-right">{t('account.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {me.containers.map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-mono text-xs font-medium">{container.id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{container.level}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={container.status} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{container.updated_at || t('common.na')}</TableCell>
                    <TableCell className="text-right">
                      {container.status === 'running' ? (
                        <Button variant="ghost" size="sm" disabled={restartContainerBusy} onClick={handleRestartContainer}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t('common.restart')}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title={t('account.noContainersTitle')} description={t('account.noContainersDescription')} className="py-8" />
          )}
        </CardContent>
      </Card>

      <AgentFormDialog
        key={formOpen ? (editingAgent?.id ?? 'create') : 'closed'}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setEditingAgent(null)
          }
        }}
        agent={editingAgent}
        showUserPicker={false}
        defaultUserId={me?.user_id}
        onSaved={() => agentsState.refetch()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('agent.deleteAgentTitle', { name: deleteTarget?.display_name || t('agent.agentFallback') })}
        description={t('agent.deleteAgentDescription')}
        confirmLabel={t('agent.deleteAgentConfirm')}
        busy={deleteBusy}
        onConfirm={handleDeleteAgent}
      />
    </div>
  )
}
