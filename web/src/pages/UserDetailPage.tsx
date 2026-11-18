import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Copy,
  HardDrive,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Snowflake,
  Trash2,
  UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { StatusBadge } from '../components/ui/status-badge'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { AgentFormDialog } from '../components/agent-form-dialog'
import { FilePanel } from '../components/agent/FilePanel'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useApi } from '../hooks/useApi'
import {
  deleteAgent,
  deleteUser,
  disposeContainer,
  freezeUser,
  reprovisionContainer,
  resetUserPassword,
  restartAgent,
  restartContainer,
  restoreAgent,
  restoreUser,
  unfreezeUser,
  updateUserRole,
  updateUserTier,
  USER_API_BASE,
  type AdminIdentity,
  type AgentDetail,
  type UserDetail,
  PORTAL_ADMIN_API_BASE,
} from '../lib/api'
import { canDispose, canReprovision, canRestart } from '../lib/containerState'
import { useCrumbLabel } from '../lib/crumbLabel'

const ALL_ROLES = ['admin', 'operator', 'support', 'auditor', 'user']
const MANAGEABLE_ROLES = ['operator', 'support', 'auditor', 'user']
const TIERS = ['free', 'pro', 'ultra']

type AccountAction = 'freeze' | 'unfreeze' | 'delete' | 'restore' | 'reset-password'

export function UserDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const detailPath = id ? `/users/${encodeURIComponent(id)}` : null
  const [showDeleted, setShowDeleted] = useState(false)
  const agentsPath = id
    ? `/users/${encodeURIComponent(id)}/agents${showDeleted ? '?include_deleted=true' : ''}`
    : null
  const userState = useApi<UserDetail>(detailPath, PORTAL_ADMIN_API_BASE)
  const agentsState = useApi<AgentDetail[]>(agentsPath, PORTAL_ADMIN_API_BASE)
  const meState = useApi<AdminIdentity>('/me', USER_API_BASE)

  const [disposeTarget, setDisposeTarget] = useState<string | null>(null)
  const [disposeBusy, setDisposeBusy] = useState(false)
  const [restartBusy, setRestartBusy] = useState(false)
  const [reprovisionBusy, setReprovisionBusy] = useState(false)
  const [restartAgentBusy, setRestartAgentBusy] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentDetail | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [restoreAgentBusy, setRestoreAgentBusy] = useState<string | null>(null)

  const [roleDraft, setRoleDraft] = useState('')
  const [tierDraft, setTierDraft] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [storageAgentOverride, setStorageAgentOverride] = useState('')

  const user = userState.data
  // The breadcrumb names the account instead of showing the URL's id; the id
  // stays on hover until the name arrives (or if it never does).
  useCrumbLabel(user ? user.display_name || user.user_id : null, id)
  const agents = agentsState.data
  const actorRole = meState.data?.role
  const isAdminActor = actorRole === 'admin'
  const targetIsAdmin = user?.role === 'admin'
  const canManageTarget = isAdminActor || !targetIsAdmin
  const roleOptions = isAdminActor ? ALL_ROLES : MANAGEABLE_ROLES
  const roleValue = roleDraft || user?.role || ''
  const tierValue = tierDraft || user?.tier || ''

  const activeAgents = (agents ?? []).filter((agent) => agent.status !== 'deleted')
  const storageAgentId =
    storageAgentOverride && activeAgents.some((agent) => agent.id === storageAgentOverride)
      ? storageAgentOverride
      : activeAgents[0]?.id ?? ''

  const runAccountAction = async (fn: () => Promise<unknown>, successKey: string) => {
    setAccountBusy(true)
    try {
      await fn()
      toast.success(t(successKey))
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.accountActionFailed'))
    } finally {
      setAccountBusy(false)
      setAccountAction(null)
    }
  }

  const handleRoleApply = async () => {
    if (!id || !roleValue || roleValue === user?.role) {
      return
    }
    setAccountBusy(true)
    try {
      await updateUserRole(id, roleValue)
      toast.success(t('userDetail.roleChanged'))
      setRoleDraft('')
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.accountActionFailed'))
      setRoleDraft('')
    } finally {
      setAccountBusy(false)
    }
  }

  const handleTierApply = async () => {
    if (!id || !tierValue || tierValue === user?.tier) {
      return
    }
    setAccountBusy(true)
    try {
      await updateUserTier(id, tierValue)
      toast.success(t('userDetail.tierChanged'))
      setTierDraft('')
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.accountActionFailed'))
      setTierDraft('')
    } finally {
      setAccountBusy(false)
    }
  }

  const handleResetPassword = async () => {
    if (!id) {
      return
    }
    setAccountBusy(true)
    try {
      const result = await resetUserPassword(id)
      setTempPassword(result.temp_password)
      toast.success(t('userDetail.passwordReset'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.accountActionFailed'))
    } finally {
      setAccountBusy(false)
      setAccountAction(null)
    }
  }

  const copyTempPassword = async () => {
    if (!tempPassword) {
      return
    }
    try {
      await navigator.clipboard.writeText(tempPassword)
      toast.success(t('userDetail.copied'))
    } catch {
      // clipboard may be unavailable; the password stays visible to copy manually
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

  const handleDispose = async () => {
    if (!id || !disposeTarget) {
      return
    }
    setDisposeBusy(true)
    try {
      await disposeContainer(id)
      toast.success(t('userDetail.disposalRequested'))
      setDisposeTarget(null)
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.disposeFailed'))
    } finally {
      setDisposeBusy(false)
    }
  }

  const handleRestart = async () => {
    if (!id) {
      return
    }
    setRestartBusy(true)
    try {
      await restartContainer(id)
      toast.success(t('account.containerRestartRequested'))
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('account.restartContainerFailed'))
    } finally {
      setRestartBusy(false)
    }
  }

  const handleReprovision = async () => {
    if (!id) {
      return
    }
    setReprovisionBusy(true)
    try {
      await reprovisionContainer(id)
      toast.success(t('userDetail.reprovisionRequested'))
      userState.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userDetail.reprovisionFailed'))
    } finally {
      setReprovisionBusy(false)
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        backTo="/admin/users"
        backLabel={t('userDetail.backToUsers')}
        title={user?.display_name || user?.user_id || id || t('userDetail.userFallback')}
        subtitle={t('userDetail.subtitle')}
        actions={
          user ? (
            <div className="flex items-center gap-2">
              {user.auth_source === 'ldap' ? <Badge variant="outline">{t('users.directory')}</Badge> : null}
              <StatusBadge status={user.status} />
              <StatusBadge status={user.agent_status} />
            </div>
          ) : null
        }
      />

      {userState.error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{userState.error}</CardContent>
        </Card>
      ) : null}

      {/* Profile */}
      <SectionCard title={t('userDetail.profile')}>
        {userState.loading ? (
          <Skeleton className="h-6 w-full" />
        ) : user ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <ProfileField label={t('userDetail.role')} value={t(`enums.role.${user.role}`)} />
            <ProfileField label={t('users.tier')} value={user.tier} />
            <ProfileField label={t('users.channels')} value={(user.channels ?? []).join(', ') || t('common.none')} />
            <ProfileField label={t('account.lastActivity')} value={user.last_activity_at || t('common.na')} />
            <ProfileField label={t('userDetail.overrideScopes')} value={(user.override_scopes ?? []).join(', ') || t('common.none')} />
          </div>
        ) : null}
      </SectionCard>

      {/* Account management */}
      <SectionCard title={t('userDetail.accountActions')}>
        {user && canManageTarget ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('userDetail.role')}</span>
            <Select value={roleValue} onValueChange={setRoleDraft}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`enums.role.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={accountBusy || roleValue === user.role}
              onClick={handleRoleApply}
            >
              {t('userDetail.apply')}
            </Button>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <span className="text-xs text-muted-foreground">{t('userDetail.tier')}</span>
            <Select value={tierValue} onValueChange={setTierDraft}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier}>
                    {tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={accountBusy || tierValue === user.tier}
              onClick={handleTierApply}
            >
              {t('userDetail.apply')}
            </Button>

            <Separator orientation="vertical" className="mx-1 h-6" />

            {user.status === 'suspended' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={accountBusy}
                onClick={() => {
                  if (id) {
                    runAccountAction(() => unfreezeUser(id), 'userDetail.userUnfrozen')
                  }
                }}
              >
                <Play className="h-3.5 w-3.5" />
                {t('userDetail.unfreeze')}
              </Button>
            ) : user.status === 'deleted' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={accountBusy}
                onClick={() => {
                  if (id) {
                    runAccountAction(() => restoreUser(id), 'userDetail.userRestored')
                  }
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('userDetail.restore')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={accountBusy} onClick={() => setAccountAction('freeze')}>
                <Snowflake className="h-3.5 w-3.5" />
                {t('userDetail.freeze')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={accountBusy || user.auth_source === 'ldap'}
              title={user.auth_source === 'ldap' ? t('userDetail.directoryAccount') : undefined}
              onClick={() => setAccountAction('reset-password')}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t('userDetail.resetPassword')}
            </Button>
            {user.status !== 'deleted' ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={accountBusy}
                onClick={() => setAccountAction('delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('userDetail.delete')}
              </Button>
            ) : null}
          </div>
        ) : user ? (
          <p className="text-sm text-muted-foreground">{t('userDetail.accountActionFailed')}</p>
        ) : null}
      </SectionCard>

      {/* Containers */}
      <SectionCard
        title={t('userDetail.containers')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              userState.refetch()
              toast.success(t('userDetail.containersRefreshed'))
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('userDetail.refresh')}
          </Button>
        }
      >
        {userState.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : user && user.containers.length > 0 ? (
          <Table stacked>
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
              {user.containers.map((container) => (
                <TableRow key={container.id}>
                  <TableCell label={t('account.id')} className="font-mono text-xs font-medium">
                    {container.id}
                  </TableCell>
                  <TableCell label={t('account.level')}>
                    <Badge variant="secondary">{container.level}</Badge>
                  </TableCell>
                  <TableCell label={t('account.status')}>
                    <StatusBadge status={container.status} />
                  </TableCell>
                  <TableCell label={t('account.updated')} className="text-right text-muted-foreground">
                    {container.updated_at || t('common.na')}
                  </TableCell>
                  <TableCell label={t('account.actions')} className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canReprovision(container.status) ? (
                        <Button variant="ghost" size="sm" disabled={reprovisionBusy} onClick={handleReprovision}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t('userDetail.reprovision')}
                        </Button>
                      ) : null}
                      {canRestart(container.status) ? (
                        <Button variant="ghost" size="sm" disabled={restartBusy} onClick={handleRestart}>
                          <ArrowRight className="h-3.5 w-3.5" />
                          {t('common.restart')}
                        </Button>
                      ) : null}
                      {canDispose(container.status) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDisposeTarget(container.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('userDetail.dispose')}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title={t('account.noContainersTitle')}
            description={t('account.noContainersDescription')}
            className="py-10"
          />
        )}
      </SectionCard>

      {/* Agents */}
      <SectionCard
        title={t('agent.agents')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                agentsState.refetch()
                toast.success(t('userDetail.agentsRefreshed'))
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('userDetail.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowDeleted((v) => !v)}>
              {showDeleted ? t('agent.hideDeleted') : t('agent.showDeleted')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('agent.newAgent')}
            </Button>
          </div>
        }
      >
        {agentsState.loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : agentsState.error ? (
          <p className="py-8 text-center text-sm text-destructive">{agentsState.error}</p>
        ) : agents && agents.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {agents.map((agent) => (
              <li key={agent.id}>
                <div className="flex items-center justify-between gap-3 rounded-md py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="truncate text-sm font-medium">{agent.display_name || agent.id}</p>
                  </div>
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
                      <div className="flex items-center gap-1">
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
            title={t('userDetail.noAgentsTitle')}
            description={t('userDetail.noAgentsDescription')}
            className="py-10"
          />
        )}
      </SectionCard>

      {/* Storage management */}
      <SectionCard
        title={t('userDetail.storageManagement')}
        actions={
          <div className="flex items-center gap-2">
            {activeAgents.length > 0 ? (
              <Select value={storageAgentId} onValueChange={setStorageAgentOverride}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t('userDetail.selectAgent')} />
                </SelectTrigger>
                <SelectContent>
                  {activeAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.display_name || agent.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        }
      >
        {agentsState.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : storageAgentId ? (
          <FilePanel agentId={storageAgentId} allowUpload={false} />
        ) : (
          <EmptyState
            icon={HardDrive}
            title={t('userDetail.storageManagement')}
            description={t('userDetail.noStorageAgents')}
            className="py-10"
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={disposeTarget !== null}
        onOpenChange={(open) => !open && setDisposeTarget(null)}
        title={t('userDetail.disposeTitle')}
        description={t('userDetail.disposeDescription', { id: disposeTarget ?? t('userDetail.thisAccount') })}
        confirmLabel={t('userDetail.dispose')}
        onConfirm={handleDispose}
        busy={disposeBusy}
      />

      <ConfirmDialog
        open={accountAction === 'freeze'}
        onOpenChange={(open) => !open && setAccountAction(null)}
        title={t('userDetail.freezeTitle')}
        description={t('userDetail.freezeDescription')}
        confirmLabel={t('userDetail.freeze')}
        onConfirm={() => {
          if (id) {
            runAccountAction(() => freezeUser(id), 'userDetail.userFrozen')
          }
        }}
        busy={accountBusy}
      />

      <ConfirmDialog
        open={accountAction === 'delete'}
        onOpenChange={(open) => !open && setAccountAction(null)}
        title={t('userDetail.deleteTitle')}
        description={t('userDetail.deleteDescription')}
        confirmLabel={t('userDetail.delete')}
        onConfirm={() => {
          if (id) {
            runAccountAction(() => deleteUser(id), 'userDetail.userDeleted')
          }
        }}
        busy={accountBusy}
      />

      <ConfirmDialog
        open={accountAction === 'reset-password'}
        onOpenChange={(open) => !open && setAccountAction(null)}
        title={t('userDetail.resetPasswordTitle')}
        description={t('userDetail.resetPasswordDescription')}
        confirmLabel={t('userDetail.resetPassword')}
        onConfirm={handleResetPassword}
        busy={accountBusy}
      />

      {/* Unfreeze / restore run immediately from the account-management buttons. */}

      <Dialog open={tempPassword !== null} onOpenChange={(open) => !open && setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('userDetail.tempPasswordTitle')}</DialogTitle>
            <DialogDescription>{t('userDetail.tempPasswordDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">{tempPassword}</code>
            <Button variant="outline" size="sm" onClick={copyTempPassword}>
              <Copy className="h-3.5 w-3.5" />
              {t('userDetail.copy')}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTempPassword(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        defaultUserId={id}
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

function SectionCard({
  title,
  actions,
  children,
}: {
  title: string
  actions?: React.ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
