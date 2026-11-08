import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Pencil, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Spinner } from '../components/ui/spinner'
import { EmptyState } from '../components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import Markdown from '../components/ui/markdown'
import { getAdminPromptBlocks, saveAdminPromptBlock } from '../lib/promptBlocks'
import { canResetPrompt } from '../lib/promptStatus'
import { RuntimeSettingsFields } from '../components/agent/RuntimeSettingsFields'
import { applicableRuntimeKeys, type RuntimeSettings } from '../components/agent/runtimeSettings'
import { ThinkingLevelField } from '../components/agent/ThinkingLevelField'
import { THINKING_SETTING_KEY, normalizeThinkingLevel } from '../lib/thinking'
import type { ThinkingChoice } from '../hooks/useThinkingLevel'
import { PermissionRulesEditor } from '../components/agent/PermissionRulesEditor'
import { LockSelect, ToolIdentity, type LockValue } from '../components/capabilities/capability-ui'
import {
  deleteTypeCapability,
  listAgentTypePromptStatus,
  listAgentTypes,
  listPermissionKeys,
  resetAgentTypePrompt,
  saveAgentType,
  setTypeCapability,
  type AgentPromptStatus,
  type AgentType,
  type PermissionKey,
  type TypeCapabilityBinding,
  type TypeModelBinding,
} from '../lib/agentTypes'
import { listAdminModels, type ModelCatalog } from '../lib/models'
import {
  listAdminMcp,
  listAdminSkills,
  listBuiltinTools,
  type BuiltinDef,
  type McpDef,
  type SkillDef,
} from '../lib/capabilities'

type CapCatalog = { builtin: BuiltinDef[]; mcp: McpDef[]; skills: SkillDef[] }

function MetaItem({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </span>
  )
}

// isSessionType mirrors the runtime rule (nanosec's Config.isSessionAgent and the
// bus's IsSessionType): a conversational type both modes share with the session
// agent. For those, the type's own prompt is the per-turn *mode switch note*, and
// the shared head prompt lives in its own store.
function isSessionType(type: AgentType | null): boolean {
  return !!type && type.output === 'stream' && type.session_binding === 'shared'
}

// isSubagentType reports whether a definition runs as a delegated subagent
// (output=caller). Its thinking level has its own platform layers and no user
// layer — see nanosec's resolveSubagentEffort.
function isSubagentType(type: AgentType | null): boolean {
  return !!type && type.output === 'caller'
}

// withThinking stores or clears the platform default thinking level in a type's
// settings draft. Empty means "follow the next platform layer".
function withThinking(settings: RuntimeSettings, next: ThinkingChoice): RuntimeSettings {
  const out = { ...settings }
  if (next) {
    out[THINKING_SETTING_KEY] = next
  } else {
    delete out[THINKING_SETTING_KEY]
  }
  return out
}

// SharedHeadPanel shows and edits the head prompt that build and plan share. It
// saves on its own endpoint (the type's Save button writes the mode note), because
// the store is keyed without a mode: editing it here also changes the other mode.
function SharedHeadPanel() {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAdminPromptBlocks()
      .then((blocks) => {
        if (!cancelled) setValue(blocks.head?.content ?? '')
      })
      .catch(() => {
        if (!cancelled) setValue('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    if (value === null) return
    setSaving(true)
    try {
      await saveAdminPromptBlock(value)
      toast.success(t('agentTypes.sharedHeadSaved'))
    } catch {
      toast.error(t('agentTypes.sharedHeadSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('agentTypes.sharedHead')}</p>
          <p className="text-xs text-muted-foreground">{t('agentTypes.sharedHeadHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? t('agentTypes.preview') : t('agentTypes.edit')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || value === null}>
            <Save className="h-4 w-4" /> {t('common.save')}
          </Button>
        </div>
      </div>
      {value === null ? (
        <Spinner />
      ) : editing ? (
        <textarea
          className="min-h-[40vh] w-full rounded-md border bg-transparent p-3 font-mono text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : value.trim() ? (
        <div className="max-h-[40vh] overflow-auto rounded-md border bg-background p-4">
          <Markdown>{value.trimEnd()}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('agentTypes.promptEmpty')}</p>
      )}
    </div>
  )
}

// promptSourceBadge says where the stored prompt stands. The text alone cannot
// tell an operator whether it is the platform's, an older seed, or their own
// edit — and "empty" reads very differently once you know the runtime then sends
// no role prompt at all.
const PROMPT_SOURCE_VARIANT: Record<AgentPromptStatus['source'], 'success' | 'warning' | 'info' | 'danger' | 'secondary'> = {
  bundled: 'success',
  stale: 'warning',
  edited: 'info',
  empty: 'danger',
  none: 'secondary',
}

function PromptSourceBadge({ status }: { status: AgentPromptStatus }) {
  const { t } = useTranslation()
  const label =
    status.source === 'bundled' || status.source === 'stale'
      ? t(`agentTypes.promptSource.${status.source}`, { version: status.bundled_version })
      : t(`agentTypes.promptSource.${status.source}`)
  return <Badge variant={PROMPT_SOURCE_VARIANT[status.source]}>{label}</Badge>
}

// PromptTab renders the prompt as Markdown with an in-page edit toggle. Edits
// mutate the caller's draft; the page-level Save persists them. The reset button
// is the one action that writes immediately, so it asks first.
function PromptTab({
  value,
  onChange,
  status,
  onReset,
}: {
  value: string
  onChange: (value: string) => void
  status?: AgentPromptStatus
  onReset?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const canReset = canResetPrompt(status) && !!onReset
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('agentTypes.promptHint')}</p>
        <div className="flex items-center gap-2">
          {status ? <PromptSourceBadge status={status} /> : null}
          {canReset ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} data-prompt-reset>
              <RotateCcw className="h-4 w-4" />
              {t('agentTypes.promptReset')}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? t('agentTypes.preview') : t('agentTypes.edit')}
          </Button>
        </div>
      </div>
      {editing ? (
        <textarea
          className="min-h-[60vh] w-full rounded-md border bg-transparent p-3 font-mono text-xs lg:min-h-[calc(100vh-19rem)]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : value.trim() ? (
        <div className="min-h-[60vh] overflow-auto rounded-md border bg-muted/20 p-4 lg:min-h-[calc(100vh-19rem)]">
          <Markdown>{value.trimEnd()}</Markdown>
        </div>
      ) : (
        <div className="flex min-h-[60vh] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground lg:min-h-[calc(100vh-19rem)]">
          {t('agentTypes.promptEmpty')}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('agentTypes.promptResetTitle')}
        description={t('agentTypes.promptResetDescription', { id: status?.id ?? '' })}
        confirmLabel={t('agentTypes.promptResetConfirm')}
        onConfirm={() => (onReset ? onReset() : Promise.resolve())}
      />
    </div>
  )
}

// TypeCapabilitiesTab edits the per-type capability baseline (default enabled +
// admin lock) for builtin tools, MCP servers and skills.
function TypeCapabilitiesTab({
  typeID,
  bindings,
  catalog,
  onChanged,
  onReset,
}: {
  typeID: string
  bindings: TypeCapabilityBinding[]
  catalog: CapCatalog
  onChanged: (binding: TypeCapabilityBinding) => void
  onReset: (kind: string, ref: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)

  const bindingFor = (kind: string, ref: string) => bindings.find((b) => b.kind === kind && b.ref === ref)

  const update = async (kind: string, ref: string, defaultEnabled: boolean, locked: LockValue) => {
    setBusy(`${kind}/${ref}`)
    try {
      await setTypeCapability(typeID, { kind, ref, default_enabled: defaultEnabled, locked })
      onChanged({ kind, ref, default_enabled: defaultEnabled, locked })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const groups: {
    kind: string
    label: string
    items: { ref: string; name?: string; description?: string }[]
  }[] = [
    {
      kind: 'builtin_tool',
      label: t('capabilities.builtinTools'),
      items: catalog.builtin.map((b) => ({ ref: b.id, description: b.description })),
    },
    {
      kind: 'mcp',
      label: t('capabilities.mcpServers'),
      items: catalog.mcp.map((m) => ({ ref: m.id, name: m.name || m.id, description: m.description })),
    },
    {
      kind: 'skill',
      label: t('capabilities.skillsGroup'),
      items: catalog.skills.map((s) => ({ ref: s.id, name: s.name || s.id, description: s.description })),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t('agentTypes.capabilitiesHint')}</p>
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          {group.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('capabilities.none')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => {
                const binding = bindingFor(group.kind, item.ref)
                const enabled = binding?.default_enabled ?? true
                const locked = (binding?.locked ?? '') as LockValue
                const rowBusy = busy === `${group.kind}/${item.ref}`
                return (
                  <div
                    key={item.ref}
                    className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                  >
                    <ToolIdentity id={item.ref} name={item.name} description={item.description} />
                    <div className="flex shrink-0 items-center gap-2">
                      {binding ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t('agentTypes.resetCapability')}
                          disabled={rowBusy}
                          onClick={() => onReset(group.kind, item.ref)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={rowBusy}
                        onChange={(e) => void update(group.kind, item.ref, e.target.checked, locked)}
                      />
                      <LockSelect
                        value={locked}
                        disabled={rowBusy}
                        onChange={(v) => void update(group.kind, item.ref, enabled, v)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function AgentTypesPage() {
  const { t } = useTranslation()
  const [types, setTypes] = useState<AgentType[]>([])
  const [keys, setKeys] = useState<PermissionKey[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [caps, setCaps] = useState<CapCatalog>({ builtin: [], mcp: [], skills: [] })
  const [selected, setSelected] = useState<AgentType | null>(null)
  // Prompt baselines are keyed by type id: the listing carries the text, this
  // carries where that text came from.
  const [promptStatus, setPromptStatus] = useState<Record<string, AgentPromptStatus>>({})
  const [tab, setTab] = useState('prompt')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [t, k, m, builtin, mcp, skills, statuses] = await Promise.all([
        listAgentTypes(true),
        listPermissionKeys(),
        listAdminModels(),
        listBuiltinTools(),
        listAdminMcp(),
        listAdminSkills(),
        // A missing baseline only costs the badge: the prompt itself still loads.
        listAgentTypePromptStatus().catch(() => ({ items: [] as AgentPromptStatus[] })),
      ])
      setTypes(t.types ?? [])
      setKeys(k.keys ?? [])
      setCatalog(m)
      setCaps({ builtin: builtin.tools ?? [], mcp: mcp.servers ?? [], skills: skills.skills ?? [] })
      setPromptStatus(Object.fromEntries((statuses.items ?? []).map((s) => [s.id, s])))
      setSelected((cur) => {
        const list = t.types ?? []
        if (cur) {
          return list.find((x) => x.id === cur.id) ?? list[0] ?? null
        }
        return list[0] ?? null
      })
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const toggleModel = (id: number) => {
    if (!selected) return
    const models = selected.models ?? []
    const exists = models.some((m) => m.model_id === id)
    const next: TypeModelBinding[] = exists
      ? models.filter((m) => m.model_id !== id)
      : [...models, { model_id: id, is_default: models.length === 0, locked: false }]
    setSelected({ ...selected, models: next })
  }

  const setDefaultModel = (id: number) => {
    if (!selected) return
    setSelected({
      ...selected,
      models: (selected.models ?? []).map((m) => ({ ...m, is_default: m.model_id === id })),
    })
  }

  const upsertCapability = (binding: TypeCapabilityBinding) => {
    setSelected((prev) => {
      if (!prev) return prev
      const list = [...(prev.capabilities ?? [])]
      const idx = list.findIndex((c) => c.kind === binding.kind && c.ref === binding.ref)
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...binding }
      } else {
        list.push(binding)
      }
      return { ...prev, capabilities: list }
    })
  }

  const removeCapability = (kind: string, ref: string) => {
    if (!selected) return
    void deleteTypeCapability(selected.id, kind, ref)
      .then(() => {
        setSelected((prev) =>
          prev
            ? { ...prev, capabilities: (prev.capabilities ?? []).filter((c) => !(c.kind === kind && c.ref === ref)) }
            : prev,
        )
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
  }

  const save = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await saveAgentType(selected)
      toast.success(t('agentTypes.saved'))
      await load()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }

  // The reset writes immediately (it is not part of the draft), so it reloads
  // both the text and the badge afterwards.
  const resetPrompt = async () => {
    if (!selected) return
    try {
      await resetAgentTypePrompt(selected.id)
      toast.success(t('agentTypes.promptResetDone'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('agentTypes.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('agentTypes.subtitle')}</p>
      </div>

      {types.length === 0 || !selected ? (
        <EmptyState title={t('agentTypes.noTypes')} description={t('agentTypes.noTypesHint')} />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-center gap-3">
                <Select
                  value={selected.id}
                  onValueChange={(id) => {
                    const next = types.find((x) => x.id === id)
                    if (next) setSelected(next)
                  }}
                >
                  <SelectTrigger className="w-full sm:w-80" aria-label={t('agentTypes.selectType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                        {type.seeded ? ` · ${t('agentTypes.builtIn')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1" />
                <Button onClick={save} disabled={busy}>
                  <Save className="h-4 w-4" /> {t('common.save')}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3">
                <MetaItem label={t('agentTypes.metaId')} value={selected.id} />
                <MetaItem
                  label={t('agentTypes.metaSeeded')}
                  value={selected.seeded ? t('agentTypes.builtIn') : '—'}
                />
                <MetaItem label={t('agentTypes.metaRole')} value={selected.role ?? ''} />
                <MetaItem label={t('agentTypes.metaStrategy')} value={selected.strategy ?? ''} />
                <MetaItem label={t('agentTypes.metaContext')} value={selected.context ?? ''} />
                <MetaItem label={t('agentTypes.metaOutput')} value={selected.output ?? ''} />
                <MetaItem label={t('agentTypes.metaBinding')} value={selected.session_binding ?? ''} />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <Tabs
              orientation="vertical"
              value={tab}
              onValueChange={setTab}
              className="flex flex-col gap-0 lg:flex-row"
            >
              <TabsList className="flex h-auto w-full flex-col items-stretch justify-start gap-1 rounded-none border-b bg-muted/30 p-2 lg:w-52 lg:border-b-0 lg:border-r">
                {[
                  ['prompt', 'agentTypes.tabPrompt'],
                  ['runtime', 'agentTypes.tabRuntime'],
                  ['models', 'agentTypes.tabModels'],
                  ['permissions', 'agentTypes.tabPermissions'],
                  ['capabilities', 'agentTypes.tabCapabilities'],
                ].map(([value, labelKey]) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="justify-start px-3 py-2 data-[state=active]:bg-background"
                  >
                    {t(labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="min-w-0 flex-1 p-4">
                <TabsContent value="prompt" className="mt-0">
                  {isSessionType(selected) ? (
                    <>
                      <SharedHeadPanel />
                      <p className="mb-2 text-sm font-medium">{t('agentTypes.modeNoteLabel')}</p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        {t('agentTypes.modeNoteHint', { mode: selected.id })}
                      </p>
                    </>
                  ) : null}
                  <PromptTab
                    value={selected.prompt ?? ''}
                    onChange={(prompt) => setSelected({ ...selected, prompt })}
                    status={promptStatus[selected.id]}
                    onReset={resetPrompt}
                  />
                </TabsContent>

                <TabsContent value="runtime" className="mt-0 flex flex-col gap-4">
                  {!selected.seeded ? (
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {(
                        [
                          ['strategy', 'agentTypes.metaStrategy', ['react', 'oneshot']],
                          [
                            'context',
                            'agentTypes.metaContext',
                            ['windowed', 'conversation', 'incremental', 'recent', 'task', 'none'],
                          ],
                          [
                            'output',
                            'agentTypes.metaOutput',
                            ['stream', 'caller', 'summary', 'session_meta', 'none'],
                          ],
                          ['session_binding', 'agentTypes.metaBinding', ['shared', 'scratch', 'isolated']],
                        ] as const
                      ).map(([field, label, options]) => (
                        <label key={field} className="text-sm">
                          <span className="font-medium">{t(label)}</span>
                          <Select
                            value={(selected[field] as string) ?? options[0]}
                            onValueChange={(v) => setSelected({ ...selected, [field]: v } as AgentType)}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((o) => (
                                <SelectItem key={o} value={o}>
                                  {o}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <label className="text-sm sm:max-w-xs">
                    <span className="font-medium">{t('agentTypes.maxRounds')}</span>
                    <Input
                      className="mt-1"
                      type="number"
                      value={selected.max_rounds ?? 0}
                      onChange={(e) => setSelected({ ...selected, max_rounds: Number(e.target.value) })}
                    />
                  </label>
                  <div>
                    <div className="text-sm font-medium">{t('agentSettings.title')}</div>
                    <p className="text-xs text-muted-foreground">{t('agentSettings.typeDescription')}</p>
                    <div className="mt-2">
                      <RuntimeSettingsFields
                        value={selected.settings ?? {}}
                        onChange={(settings) => setSelected({ ...selected, settings })}
                        applicable={applicableRuntimeKeys(selected)}
                      />
                    </div>
                  </div>
                  {/* The platform default for this type. Session modes resolve it
                      below the user's own choice and above the model catalog entry
                      (nanosec's resolveThinkingEffort); subagents have no user layer,
                      so theirs resolves above the platform-wide subagent default
                      (resolveSubagentEffort). */}
                  {isSessionType(selected) || isSubagentType(selected) ? (
                    <ThinkingLevelField
                      choice={normalizeThinkingLevel(selected.settings?.[THINKING_SETTING_KEY])}
                      inheritLabel={t(isSubagentType(selected) ? 'thinking.followPlatform' : 'thinking.followModel')}
                      hint={t(isSubagentType(selected) ? 'thinking.subagentPlatformHint' : 'thinking.platformHint')}
                      onChange={(next) =>
                        setSelected({ ...selected, settings: withThinking(selected.settings ?? {}, next) })
                      }
                    />
                  ) : null}
                </TabsContent>

                <TabsContent value="models" className="mt-0">
                  <div className="text-sm font-medium">{t('agentTypes.allowedModels')}</div>
                  <p className="text-xs text-muted-foreground">{t('agentTypes.allowedModelsHint')}</p>
                  <div className="mt-2 flex max-h-80 flex-col gap-1 overflow-auto rounded-md border p-2">
                    {(catalog?.models ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t('agentTypes.noModels')}</span>
                    ) : (
                      (catalog?.models ?? []).map((m) => {
                        const binding = (selected.models ?? []).find((b) => b.model_id === m.id)
                        return (
                          <div key={m.id} className="flex items-center gap-3 text-sm">
                            <input type="checkbox" checked={!!binding} onChange={() => toggleModel(m.id)} />
                            <span className="min-w-0 flex-1 truncate">
                              {m.name} <span className="text-xs text-muted-foreground">({m.model})</span>
                            </span>
                            {binding ? (
                              <>
                                <label className="flex items-center gap-1 text-xs">
                                  <input
                                    type="radio"
                                    name="default-model"
                                    checked={binding.is_default}
                                    onChange={() => setDefaultModel(m.id)}
                                  />
                                  {t('agentTypes.default')}
                                </label>
                                <label className="flex items-center gap-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={binding.locked}
                                    onChange={() =>
                                      setSelected({
                                        ...selected,
                                        models: (selected.models ?? []).map((b) =>
                                          b.model_id === m.id ? { ...b, locked: !b.locked } : b,
                                        ),
                                      })
                                    }
                                  />
                                  {t('agentTypes.lock')}
                                </label>
                              </>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="permissions" className="mt-0">
                  <PermissionRulesEditor
                    keys={keys}
                    value={selected.permissions ?? []}
                    onChange={(permissions) => setSelected({ ...selected, permissions })}
                  />
                </TabsContent>

                <TabsContent value="capabilities" className="mt-0">
                  <TypeCapabilitiesTab
                    typeID={selected.id}
                    bindings={selected.capabilities ?? []}
                    catalog={caps}
                    onChanged={upsertCapability}
                    onReset={removeCapability}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </Card>
        </>
      )}
    </div>
  )
}
