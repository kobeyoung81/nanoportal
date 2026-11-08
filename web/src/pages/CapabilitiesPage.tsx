import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Badge } from '../components/ui/badge'
import {
  LockSelect,
  McpFormDialog,
  ScopeBadge,
  SkillFormDialog,
  ToolIdentity,
  type LockValue,
} from '../components/capabilities/capability-ui'
import {
  createAdminMcp,
  createAdminSkill,
  deleteAdminMcp,
  deleteAdminSkill,
  listAdminMcp,
  listAdminSkills,
  listBuiltinTools,
  testAdminMcp,
  type BuiltinDef,
  type McpDef,
  type McpInput,
  updateAdminMcp,
  updateAdminSkill,
  updateBuiltin,
  updateMcpState,
  updateSkillState,
  type SkillDef,
  type SkillInput,
} from '../lib/capabilities'
import { TestResultDialog, type ProbeResult } from '../components/TestResultDialog'
import { normalizeCapabilityLists } from '../lib/capabilityLists'

export default function CapabilitiesPage() {
  const { t } = useTranslation()

  const [servers, setServers] = useState<McpDef[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [builtins, setBuiltins] = useState<BuiltinDef[]>([])
  const [loading, setLoading] = useState(true)

  const [mcpHidden, setMcpHidden] = useState<{ open: boolean; edit?: McpDef }>({ open: false })
  const [skillHidden, setSkillHidden] = useState<{ open: boolean; edit?: SkillDef }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'mcp' | 'skills'; id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testTitle, setTestTitle] = useState('')
  const [testResult, setTestResult] = useState<ProbeResult | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  const runTest = useCallback(
    async (body: { id?: string; transport?: string; url?: string; headers?: Record<string, string> }, title: string) => {
      setTestTitle(title)
      setTestResult(null)
      setTestOpen(true)
      setTesting(true)
      try {
        setTestResult(await testAdminMcp(body))
      } catch (err) {
        setTestResult({ ok: false, error: String(err) })
      } finally {
        setTesting(false)
      }
    },
    [],
  )

  // applyCatalog reads a missing list as empty. The bus used to answer a fresh
  // installation with `tools: null`, and `builtins.length` then blanked the page
  // (see lib/capabilityLists).
  const applyCatalog = useCallback(
    (mcp: { servers?: McpDef[] | null }, skills: { skills?: SkillDef[] | null }, builtin: { tools?: BuiltinDef[] | null }) => {
      const lists = normalizeCapabilityLists({ servers: mcp.servers, skills: skills.skills, tools: builtin.tools })
      setServers(lists.servers)
      setSkills(lists.skills)
      setBuiltins(lists.builtins)
    },
    [],
  )

  const reload = useCallback(async () => {
    try {
      const [mcp, skills, builtin] = await Promise.all([listAdminMcp(), listAdminSkills(), listBuiltinTools()])
      applyCatalog(mcp, skills, builtin)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [applyCatalog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [mcp, skills, builtin] = await Promise.all([listAdminMcp(), listAdminSkills(), listBuiltinTools()])
        if (cancelled) {
          return
        }
        applyCatalog(mcp, skills, builtin)
      } catch (err) {
        toast.error(String(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyCatalog])

  const saveMcp = useCallback(
    async (body: McpInput) => {
      setBusy(true)
      try {
        if (body.id) {
          await updateAdminMcp(body.id, body)
          toast.success(t('capabilities.updated'))
        } else {
          await createAdminMcp(body)
          toast.success(t('capabilities.created'))
        }
        setMcpHidden({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload, t],
  )

  const saveSkill = useCallback(
    async (body: SkillInput) => {
      setBusy(true)
      try {
        if (body.id) {
          await updateAdminSkill(body.id, body)
          toast.success(t('capabilities.updated'))
        } else {
          await createAdminSkill(body)
          toast.success(t('capabilities.created'))
        }
        setSkillHidden({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload, t],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }
    setBusy(true)
    try {
      if (deleteTarget.kind === 'mcp') {
        await deleteAdminMcp(deleteTarget.id)
      } else {
        await deleteAdminSkill(deleteTarget.id)
      }
      toast.success(t('capabilities.deleted'))
      setDeleteTarget(null)
      await reload()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }, [deleteTarget, reload, t])

  const setBuiltinState = useCallback(
    async (id: string, patch: { default_enabled?: boolean; locked?: LockValue }) => {
      setBusy(true)
      try {
        await updateBuiltin(id, patch)
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  const setSkillState = useCallback(
    async (id: string, patch: { default_enabled?: boolean; locked?: LockValue }) => {
      setBusy(true)
      try {
        // Definition-plane default only: works for bundled (read-only content)
        // skills too, since the state endpoint never touches skill content.
        await updateSkillState(id, patch)
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  const setMcpState = useCallback(
    async (id: string, patch: { default_enabled?: boolean; locked?: LockValue }) => {
      setBusy(true)
      try {
        await updateMcpState(id, patch)
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  const mcpList = useMemo(
    () => (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setMcpHidden({ open: true })}>
            <Plus className="h-4 w-4" />
            {t('capabilities.addMcp')}
          </Button>
        </div>
        {servers.length === 0 ? (
          <EmptyState title={t('capabilities.noMcp')} description={t('capabilities.noMcpHint')} />
        ) : (
          <Card>
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('capabilities.name')}</TableHead>
                  <TableHead>{t('capabilities.scope')}</TableHead>
                  <TableHead>{t('capabilities.transport')}</TableHead>
                  <TableHead>{t('capabilities.defaultEnabled')}</TableHead>
                  <TableHead>{t('capabilities.lock')}</TableHead>
                  <TableHead className="text-right">{t('capabilities.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell label={t('capabilities.name')}>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.id}</div>
                    </TableCell>
                    <TableCell label={t('capabilities.scope')}>
                      <ScopeBadge scope={s.scope} />
                    </TableCell>
                    <TableCell label={t('capabilities.transport')} className="font-mono text-xs">
                      {s.transport}
                    </TableCell>
                    <TableCell label={t('capabilities.defaultEnabled')}>
                      <Switch checked={s.default_enabled} onCheckedChange={(v) => setMcpState(s.id, { default_enabled: v })} disabled={busy} />
                    </TableCell>
                    <TableCell label={t('capabilities.lock')}>
                      <LockSelect value={s.locked} onChange={(v) => setMcpState(s.id, { locked: v })} disabled={busy} />
                    </TableCell>
                    <TableCell label={t('capabilities.actions')} className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={busy || testing} onClick={() => runTest({ id: s.id }, s.name)}>
                          {t('tests.test')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setMcpHidden({ open: true, edit: s })}>
                          {t('common.edit')}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: 'mcp', id: s.id, name: s.name })}>
                          {t('common.delete')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    ),
    [servers, busy, testing, t, setMcpState, runTest],
  )

  const skillList = useMemo(
    () => (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setSkillHidden({ open: true })}>
            <Plus className="h-4 w-4" />
            {t('capabilities.addSkill')}
          </Button>
        </div>
        {skills.length === 0 ? (
          <EmptyState title={t('capabilities.noSkills')} description={t('capabilities.noSkillsHint')} />
        ) : (
          <Card>
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('capabilities.name')}</TableHead>
                  <TableHead>{t('capabilities.scope')}</TableHead>
                  <TableHead>{t('capabilities.filesCount')}</TableHead>
                  <TableHead>{t('capabilities.defaultEnabled')}</TableHead>
                  <TableHead>{t('capabilities.lock')}</TableHead>
                  <TableHead className="text-right">{t('capabilities.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((s) => {
                  const bundled = s.origin === 'bundled'
                  return (
                    <TableRow key={s.id}>
                      <TableCell label={t('capabilities.name')}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {bundled && <Badge variant="secondary">{t('capabilities.bundled')}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.id}</div>
                      </TableCell>
                      <TableCell label={t('capabilities.scope')}>
                        <ScopeBadge scope={s.scope} />
                      </TableCell>
                      <TableCell label={t('capabilities.filesCount')}>
                        {Object.keys(s.files ?? {}).length}
                      </TableCell>
                      <TableCell label={t('capabilities.defaultEnabled')}>
                        <Switch
                          checked={s.default_enabled}
                          onCheckedChange={(v) => setSkillState(s.id, { default_enabled: v })}
                          disabled={busy}
                        />
                      </TableCell>
                      <TableCell label={t('capabilities.lock')}>
                        <LockSelect value={s.locked} onChange={(v) => setSkillState(s.id, { locked: v })} disabled={busy} />
                      </TableCell>
                      <TableCell label={t('capabilities.actions')} className="text-right">
                        {bundled ? (
                          <span className="text-xs text-muted-foreground">{t('capabilities.bundledReadOnly')}</span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setSkillHidden({ open: true, edit: s })}>
                              {t('common.edit')}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: 'skills', id: s.id, name: s.name })}>
                              {t('common.delete')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    ),
    [skills, t, busy, setSkillState],
  )

  const builtinList = useMemo(
    () =>
      builtins.length === 0 ? (
        <EmptyState title={t('capabilities.noBuiltins')} description={t('capabilities.noBuiltinsHint')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {builtins.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
            >
              <ToolIdentity id={b.id} description={b.description} />
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={b.default_enabled}
                  onCheckedChange={(v) => setBuiltinState(b.id, { default_enabled: v })}
                  disabled={busy}
                />
                <LockSelect
                  value={b.locked}
                  onChange={(v) => setBuiltinState(b.id, { locked: v })}
                  disabled={busy}
                />
              </div>
            </div>
          ))}
        </div>
      ),
    [builtins, busy, t, setBuiltinState],
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('nav.capabilities')}</h1>
        <p className="text-sm text-muted-foreground">{t('capabilities.adminHint')}</p>
      </div>

      <Tabs defaultValue="mcp">
        <TabsList>
          <TabsTrigger value="mcp">{t('capabilities.mcpServers')}</TabsTrigger>
          <TabsTrigger value="skills">{t('capabilities.skillsGroup')}</TabsTrigger>
          <TabsTrigger value="builtin">{t('capabilities.builtinTools')}</TabsTrigger>
        </TabsList>
        <TabsContent value="mcp">{loading ? null : mcpList}</TabsContent>
        <TabsContent value="skills">{loading ? null : skillList}</TabsContent>
        <TabsContent value="builtin">{loading ? null : builtinList}</TabsContent>
      </Tabs>

      <McpFormDialog
        key={`mcp:${mcpHidden.open}:${mcpHidden.edit?.id ?? 'new'}`}
        open={mcpHidden.open}
        onOpenChange={(open) => setMcpHidden({ open })}
        initial={mcpHidden.edit}
        onSubmit={saveMcp}
        onTest={(body) => runTest({ id: body.id, transport: body.transport, url: body.url, headers: body.headers }, body.name)}
        testing={testing}
        busy={busy}
      />
      <SkillFormDialog
        key={`skill:${skillHidden.open}:${skillHidden.edit?.id ?? 'new'}`}
        open={skillHidden.open}
        onOpenChange={(open) => setSkillHidden({ open })}
        initial={skillHidden.edit}
        onSubmit={saveSkill}
        busy={busy}
      />
      <TestResultDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        title={t('tests.mcpTitle', { name: testTitle })}
        result={testResult}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('capabilities.deleteTitle')}
        description={t('capabilities.deleteHint', { name: deleteTarget?.name ?? '' })}
      />
    </div>
  )
}