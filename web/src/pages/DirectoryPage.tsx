import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, RefreshCw, Save, ShieldCheck, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '../components/page-header'
import { ConnectionCard } from '../components/directory/ConnectionCard'
import { DryRunCard } from '../components/directory/DryRunCard'
import { GroupCard } from '../components/directory/GroupCard'
import { PolicyCard } from '../components/directory/PolicyCard'
import { RawCard } from '../components/directory/RawCard'
import { SearchCard } from '../components/directory/SearchCard'
import { StatusCard } from '../components/directory/StatusCard'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { useApi } from '../hooks/useApi'
import type {
  AnalyzeResult,
  BrowseNode,
  BrowseResult,
  CheckResponse,
  EffectiveResponse,
  FieldError,
  ProbeResult,
  Recommendation,
} from '../lib/directoryApi'
import {
  analyzeDirectory,
  browseDirectory,
  checkLogin,
  getDirectoryEffective,
  putDirectoryKey,
  searchDirectory,
  testConnection,
  validateDraft,
} from '../lib/directoryApi'
import type { DirectoryDraft } from '../lib/directoryFields'
import { changedKeys, draftFromConfig } from '../lib/directoryFields'
import { readRawState, writeRawState } from '../lib/clientState'
import { USER_API_BASE, type AdminIdentity, type ConfigDetail } from '../lib/api'

const ROLE_EDITABLE = new Set(['operator', 'admin'])
const GROUP_FILTER_AD = '(objectClass=group)'
const GROUP_FILTER_OPENLDAP =
  '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames)(objectClass=posixGroup))'

type LastProbe = { at: string; ok: boolean }

// DirectoryPage is the console for the LDAP directory login: the settings, plus
// the read-only diagnostics that make them verifiable. The settings are the same
// rows the config center edits (service_config_items, component auth), so both
// surfaces always show one truth.
export function DirectoryPage() {
  const { t } = useTranslation()
  const configState = useApi<ConfigDetail>('/configs/auth')
  const meState = useApi<AdminIdentity>('/me', USER_API_BASE)

  // The stored settings are the baseline; the draft is an override on top of
  // them, so a refetch never has to be pushed back into React state by an effect.
  const [override, setOverride] = useState<DirectoryDraft | null>(null)
  const [errors, setErrors] = useState<Record<string, FieldError>>({})
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)

  const [effective, setEffective] = useState<EffectiveResponse | null>(null)
  const [effectiveRefresh, setEffectiveRefresh] = useState(0)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [lastProbe, setLastProbe] = useState<LastProbe | null>(() => readLastProbe())

  const [roots, setRoots] = useState<BrowseNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const [groupFilter, setGroupFilter] = useState('')
  const [groups, setGroups] = useState<BrowseNode[] | null>(null)
  const [searchingGroups, setSearchingGroups] = useState(false)

  const [check, setCheck] = useState<CheckResponse | null>(null)
  const [checking, setChecking] = useState(false)

  const canEdit = meState.data ? ROLE_EDITABLE.has(meState.data.role) : false
  const disabled = !canEdit

  const stored = useMemo(
    () => (configState.data ? draftFromConfig(configState.data.config) : null),
    [configState.data],
  )
  const baseline = useMemo(() => stored?.draft ?? {}, [stored])
  const unknownKeys = useMemo(() => stored?.unknownKeys ?? [], [stored])
  const draft: DirectoryDraft = override ?? baseline

  const refreshEffective = useCallback(() => {
    setEffectiveRefresh((current) => current + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    getDirectoryEffective()
      .then((data) => {
        if (!cancelled) {
          setEffective(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEffective(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [effectiveRefresh])

  const setValue = useCallback(
    (key: string, value: string) => {
      setOverride((current) => ({ ...(current ?? baseline), [key]: value }))
      setErrors((current) => {
      if (!(key in current)) {
        return current
      }
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    [baseline],
  )

  const changed = useMemo(() => changedKeys(draft, baseline), [draft, baseline])

  const discard = () => {
    setOverride(null)
    setErrors({})
  }

  const runValidate = async (announce: boolean): Promise<boolean> => {
    setValidating(true)
    try {
      const result = await validateDraft(draft)
      setErrors(result.errors ?? {})
      if (result.valid) {
        if (announce) {
          toast.success(t('directory.validateOk'))
        }
        return true
      }
      const first = Object.keys(result.errors ?? {})[0]
      toast.error(t('directory.validateFailed', { key: first ?? '' }))
      return false
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.validateFailed', { key: '' }))
      return false
    } finally {
      setValidating(false)
    }
  }

  const save = async () => {
    if (Object.keys(changed).length === 0) {
      toast.info(t('directory.noChanges'))
      return
    }
    if (!(await runValidate(false))) {
      return
    }
    setSaving(true)
    const failed: { key: string; message: string }[] = []
    for (const [key, value] of Object.entries(changed)) {
      try {
        await putDirectoryKey(key, value)
      } catch (err) {
        failed.push({ key, message: err instanceof Error ? err.message : String(err) })
      }
    }
    setSaving(false)

    if (failed.length > 0) {
      const first = failed[0]
      toast.error(t('directory.savePartial', { key: first.key, message: first.message }))
      configState.refetch()
      refreshEffective()
      return
    }

    toast.success(t('directory.saved', { count: Object.keys(changed).length }))
    configState.refetch()
    refreshEffective()
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await testConnection(draft)
      setProbe(result)
      const stamp = { at: new Date().toISOString(), ok: result.ok }
      setLastProbe(stamp)
      writeRawState('directory', 'lastProbe', JSON.stringify(stamp))
      if (result.ok) {
        toast.success(t('directory.probeOk'))
      } else {
        toast.error(t('directory.probeFailed'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.probeFailed'))
    } finally {
      setTesting(false)
    }
  }

  const applyPreset = () => {
    if (!probe || probe.preset.kind === 'unknown') {
      return
    }
    setOverride((current) => ({
      ...(current ?? baseline),
      'ldap.userFilter': probe.preset.user_filter,
      'ldap.attrUniqueId': probe.preset.attr_unique_id,
      'ldap.attrUsername': probe.preset.attr_username,
      'ldap.attrDisplayName': probe.preset.attr_display_name,
    }))
    toast.success(t('directory.presetApplied'))
  }

  const browseRoot = async () => {
    setTreeLoading(true)
    try {
      const result = await browseDirectory(draft, draft['ldap.baseDN'] ?? '')
      setRoots(result.nodes)
      if (result.naming_contexts?.length && !(draft['ldap.baseDN'] ?? '')) {
        setOverride((current) => ({
          ...(current ?? baseline),
          'ldap.baseDN': result.naming_contexts?.[0] ?? '',
        }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.treeReadFailed'))
    } finally {
      setTreeLoading(false)
    }
  }

  const browseNode = async (dn: string): Promise<BrowseResult> => browseDirectory(draft, dn)

  const runAnalyze = async () => {
    const baseDN = draft['ldap.baseDN'] ?? ''
    if (!baseDN) {
      toast.error(t('directory.baseDNRequired'))
      return
    }
    setAnalyzing(true)
    try {
      setAnalyze(await analyzeDirectory(draft, baseDN))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.analyzeFailed'))
    } finally {
      setAnalyzing(false)
    }
  }

  const applyRecommendation = (rec: Recommendation) => {
    if (!rec.value) {
      return
    }
    setValue(rec.key, rec.value)
  }

  const applyAll = () => {
    const suggestions = (analyze?.recommendations ?? []).filter((rec) => rec.level === 'suggestion')
    setOverride((current) => {
      const next = { ...(current ?? baseline) }
      for (const rec of suggestions) {
        next[rec.key] = rec.value
      }
      return next
    })
    toast.success(t('directory.suggestionsApplied', { count: suggestions.length }))
  }

  const searchGroups = async () => {
    const filter =
      groupFilter ||
      (probe?.kind === 'ad' ? GROUP_FILTER_AD : GROUP_FILTER_OPENLDAP)
    if (!groupFilter) {
      setGroupFilter(filter)
    }
    setSearchingGroups(true)
    try {
      const result = await searchDirectory(draft, draft['ldap.baseDN'] ?? '', filter)
      setGroups(result.nodes.filter((node) => node.kind === 'group'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.groupSearchFailed'))
    } finally {
      setSearchingGroups(false)
    }
  }

  const dryRun = async (email: string, password: string) => {
    setChecking(true)
    try {
      setCheck(await checkLogin(draft, email, password))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('directory.dryRunFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('nav.directoryLogin')}
        subtitle={t('directory.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {Object.keys(changed).length > 0 ? (
              <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                <Undo2 className="h-4 w-4" />
                {t('directory.discard')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runValidate(true)}
              disabled={disabled || validating}
            >
              <ShieldCheck className="h-4 w-4" />
              {t('directory.validate')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                configState.refetch()
                refreshEffective()
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={disabled || saving}>
              <Save className="h-4 w-4" />
              {t('directory.save', { count: Object.keys(changed).length })}
            </Button>
          </div>
        }
      />

      {configState.error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{configState.error}</CardContent>
        </Card>
      ) : null}

      {!canEdit && meState.data ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            {t('directory.readOnlyRole')}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <StatusCard
            draft={draft}
            setValue={setValue}
            errors={errors}
            effective={effective}
            probe={probe}
            probeAt={lastProbe?.at ?? null}
            disabled={disabled}
          />
          <ConnectionCard
            draft={draft}
            setValue={setValue}
            errors={errors}
            probe={probe}
            testing={testing}
            onTest={() => void test()}
            onApplyPreset={applyPreset}
            disabled={disabled}
          />
          <PolicyCard draft={draft} setValue={setValue} errors={errors} disabled={disabled} />
        </div>

        <div className="flex flex-col gap-6">
          <SearchCard
            draft={draft}
            setValue={setValue}
            errors={errors}
            roots={roots}
            treeLoading={treeLoading}
            onBrowseRoot={() => void browseRoot()}
            onBrowse={browseNode}
            analyze={analyze}
            analyzing={analyzing}
            onAnalyze={() => void runAnalyze()}
            onApplyRecommendation={applyRecommendation}
            onApplyAll={applyAll}
            disabled={disabled}
          />
          <GroupCard
            draft={draft}
            setValue={setValue}
            errors={errors}
            groupFilter={groupFilter}
            onGroupFilterChange={setGroupFilter}
            groups={groups}
            searching={searchingGroups}
            onSearch={() => void searchGroups()}
            disabled={disabled}
          />
          <DryRunCard
            draft={draft}
            onCheck={(email, password) => void dryRun(email, password)}
            checking={checking}
            result={check}
            disabled={disabled}
          />
          <RawCard draft={draft} setValue={setValue} unknownKeys={unknownKeys} disabled={disabled} />
        </div>
      </div>
    </div>
  )
}

function readLastProbe(): LastProbe | null {
  const raw = readRawState('directory', 'lastProbe')
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as LastProbe
    return typeof parsed?.at === 'string' ? parsed : null
  } catch {
    return null
  }
}

export default DirectoryPage
