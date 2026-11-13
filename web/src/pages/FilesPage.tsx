import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderTree, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Badge } from '../components/ui/badge'
import { FilePanel } from '../components/agent/FilePanel'
import { useApi } from '../hooks/useApi'
import {
  PORTAL_ADMIN_API_BASE,
  USER_API_BASE,
  type AgentDetail,
  type UserSummary,
} from '../lib/api'

export function FilesPage({ variant = 'self' }: { variant?: 'self' | 'admin' }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlAgent = searchParams.get('agent')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(urlAgent)

  const selfAgentsState = useApi<AgentDetail[]>('/me/agents', USER_API_BASE)
  const usersState = useApi<UserSummary[]>('/users', PORTAL_ADMIN_API_BASE)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)

  const agentsPath =
    variant === 'admin' && selectedUser ? `/users/${encodeURIComponent(selectedUser)}/agents` : null
  const agentsState = useApi<AgentDetail[]>(agentsPath, PORTAL_ADMIN_API_BASE)

  const agentOptions: AgentDetail[] =
    variant === 'self' ? (selfAgentsState.data ?? []) : (agentsState.data ?? [])

  const handleSelectAgent = (agentId: string | null) => {
    setSelectedAgent(agentId)
    if (agentId) {
      setSearchParams({ agent: agentId })
    } else {
      setSearchParams({})
    }
  }

  const loading = variant === 'self' ? selfAgentsState.loading : agentsState.loading

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('files.title')}
        subtitle={
          variant === 'self'
            ? t('files.subtitleSelf')
            : t('files.subtitleAdmin')
        }
        actions={
          <div className="flex items-center gap-2">
            {variant === 'self' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(selectedAgent ? `/agent?agent=${encodeURIComponent(selectedAgent)}` : '/agent')}
              >
                <ArrowLeft className="h-4 w-4" />
                {t('files.backToAgent')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (variant === 'self') {
                  selfAgentsState.refetch()
                }
                toast.success(t('files.refreshed'))
              }}
              disabled={!selectedAgent}
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          {variant === 'admin' ? (
            <Select
              value={selectedUser ?? 'none'}
              onValueChange={(value) => {
                setSelectedUser(value === 'none' ? null : value)
                handleSelectAgent(null)
              }}
            >
              <SelectTrigger className="sm:w-64">
                <SelectValue placeholder={t('files.pickUser')} />
              </SelectTrigger>
              <SelectContent>
                {usersState.data?.map((user) => (
                  <SelectItem key={user.user_id} value={user.user_id}>
                    {user.display_name || user.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select
            value={selectedAgent ?? 'none'}
            onValueChange={(value) => handleSelectAgent(value === 'none' ? null : value)}
            disabled={variant === 'admin' && !selectedUser}
          >
            <SelectTrigger className="sm:w-64">
              <SelectValue
                placeholder={
                  variant === 'admin' ? (selectedUser ? t('files.pickAgent') : t('files.pickUserFirst')) : t('files.pickAgent')
                }
              />
            </SelectTrigger>
            <SelectContent>
              {agentOptions.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.display_name || agent.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedAgent ? <Badge variant="secondary">{selectedAgent}</Badge> : null}
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : selectedAgent ? (
        <Card className="h-[calc(100vh-16rem)] min-h-96">
          <CardContent className="h-full p-0">
            <FilePanel key={selectedAgent} agentId={selectedAgent} allowUpload={variant === 'self'} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={FolderTree}
          title={t('files.selectAgentToBrowse')}
          description={variant === 'self' ? t('files.selectAgentSelf') : t('files.selectAgentAdmin')}
          className="py-16"
        />
      )}
    </div>
  )
}
