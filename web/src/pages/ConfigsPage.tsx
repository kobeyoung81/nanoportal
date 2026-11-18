import { useState } from 'react'
import { Check, Pencil, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { JsonView } from '../components/JsonView'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useApi } from '../hooks/useApi'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { putJson, USER_API_BASE, type AdminIdentity, type ConfigDetail, type ConfigSummary } from '../lib/api'

const ROLE_EDITABLE = new Set(['operator', 'admin'])

export function ConfigsPage() {
  const { t } = useTranslation()
  const listState = useApi<ConfigSummary[]>('/configs')
  const meState = useApi<AdminIdentity>('/me', USER_API_BASE)

  const [selectedComponentOverride, setSelectedComponentOverride] = useState<string | null>(null)
  const selectedComponent = selectedComponentOverride ?? listState.data?.[0]?.component_type ?? null
  const detailPath = selectedComponent ? `/configs/${encodeURIComponent(selectedComponent)}` : null
  const detailState = useApi<ConfigDetail>(detailPath)

  const canEdit = meState.data ? ROLE_EDITABLE.has(meState.data.role) : false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.configCenter')}
        subtitle={t('configs.subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              listState.refetch()
              if (detailPath) {
                detailState.refetch()
              }
              toast.success(t('configs.refreshed'))
            }}
          >
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

      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>{t('configs.domains')}</CardTitle>
            <CardDescription>{t('configs.domainsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {listState.loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : listState.data && listState.data.length > 0 ? (
              <div className="flex flex-col gap-1">
                {listState.data.map((config) => (
                  <button
                    key={config.component_type}
                    type="button"
                    onClick={() => setSelectedComponentOverride(config.component_type)}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      config.component_type === selectedComponent
                        ? 'bg-primary-weak font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <span className="truncate">{config.component_type}</span>
                    <span className="shrink-0 text-xs">{config.updated_at || t('common.na')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title={t('configs.noDomains')} className="py-8" />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-3">
          {detailPath ? (
            <ConfigDetailCard
              key={detailPath}
              state={detailState}
              canEdit={canEdit}
              component={selectedComponent!}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ConfigDetailCard({
  state,
  canEdit,
  component,
}: {
  state: { data: ConfigDetail | null; loading: boolean; error: string | null; refetch: () => void }
  canEdit: boolean
  component: string
}) {
  const config = state.data?.config ?? {}
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const { run } = useAsyncAction()
  const { t } = useTranslation()

  const keyEditable = () => canEdit

  if (state.loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-60 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (state.error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">{state.error}</CardContent>
      </Card>
    )
  }

  const entries = Object.entries(config).sort(([a], [b]) => a.localeCompare(b))
  const editable = entries.filter(([, value]) => isScalar(value))
  const nested = entries.filter(([, value]) => !isScalar(value))

  const saveKey = async (key: string) => {
    const value = drafts[key]
    if (value === undefined) {
      return
    }
    setSavingKey(key)
    try {
      await run(async () => {
        await putJson(`/configs/${encodeURIComponent(component)}/${encodeURIComponent(key)}`, {
          value,
        })
        setDrafts((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
        toast.success(t('configs.updatedKey', { key }))
        state.refetch()
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('configs.updateFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{component}</CardTitle>
          <CardDescription>
            {t('configs.updatedAt', { time: state.data?.updated_at || t('common.na') })}
          </CardDescription>
        </div>
        {!canEdit ? <Badge variant="secondary">{t('configs.readOnlyRole')}</Badge> : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {editable.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('configs.editableValues')}</h3>
              <Table stacked>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">{t('configs.key')}</TableHead>
                    <TableHead>{t('configs.value')}</TableHead>
                    <TableHead className="w-24 text-right">{t('account.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editable.map(([key, value]) => {
                    const dirty = drafts[key] !== undefined
                    return (
                      <TableRow key={key}>
                        <TableCell label={t('configs.key')} className="font-mono text-xs font-medium">
                          {key}
                        </TableCell>
                        <TableCell label={t('configs.value')}>
                          <div className="flex items-center gap-2">
                            <Input
                              className="h-8 min-w-0 flex-1 font-mono text-xs"
                              defaultValue={String(value)}
                              disabled={!keyEditable()}
                              onChange={(event) =>
                                setDrafts((current) => ({ ...current, [key]: event.target.value }))
                              }
                            />
                            {dirty ? (
                              <Badge variant="warning" className="shrink-0 whitespace-nowrap">
                                {t('configs.unsaved')}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="shrink-0 whitespace-nowrap">
                                {t('configs.saved')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell label={t('account.actions')} className="text-right">
                          <div className="flex justify-end gap-1">
                            {dirty ? (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      disabled={!keyEditable()}
                                      onClick={() => {
                                        setDrafts((current) => {
                                          const next = { ...current }
                                          delete next[key]
                                          return next
                                        })
                                      }}
                                      aria-label={t('configs.discardKey', { key })}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('configs.discardChanges')}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8"
                                      disabled={!keyEditable() || savingKey === key}
                                      onClick={() => saveKey(key)}
                                      aria-label={`${t('common.save')} ${key}`}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('common.save')}</TooltipContent>
                                </Tooltip>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Pencil className="h-3 w-3" />
                                {keyEditable() ? t('configs.editable') : '—'}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {nested.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('configs.structuredValues')}</h3>
              <JsonView value={Object.fromEntries(nested)} />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
