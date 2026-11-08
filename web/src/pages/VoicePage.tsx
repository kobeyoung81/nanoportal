// The console for the composer's dictation.
//
// Three tiers, one card each, because they answer different questions: which
// model hears you while you talk (tier 1), whether an external model
// re-transcribes the whole take afterwards (tier 2), and whether a chat model
// rewrites the winning text (tier 3).
//
// The settings are the same service_config_items rows the config center edits, so
// both surfaces always show one truth.
//
// Providers come from the model catalog and must speak the OpenAI subset the bus
// dials (a base_url ending in /v1). "Check engine" is exactly that test — a
// service of another shape needs its own adapter, the way nanoasr adapts
// sherpa-onnx, not a new provider kind here.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { RecognitionTest } from '../components/voice/RecognitionTest'
import { ShortcutCapture } from '../components/composer/ShortcutCapture'
import { VoiceCard, VoiceField, VoiceSwitch } from '../components/voice/VoiceCard'
import { listAdminModels, testAdminProvider, type ModelCatalog } from '../lib/models'
import {
  UNREADABLE,
  loadVoiceSettings,
  polishThinkingValue,
  saveVoiceSettings,
  type BatchTrigger,
  type RealtimeEngine,
  type VoiceSettings,
} from '../lib/voiceAdmin'
import { resetVoiceConfigCache } from '../voice/useVoiceConfig'

const NONE = '__none__'

export function VoicePage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<VoiceSettings | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog>({ providers: [], models: [] })
  // Saving is only allowed after a successful read: a write on top of invented
  // defaults is how this configuration once got blanked.
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [engineModels, setEngineModels] = useState<string[] | null>(null)

  const applySettings = useCallback((next: VoiceSettings, models: ModelCatalog) => {
    setSettings(next)
    setCatalog(models)
    setLoaded(true)
    setError(null)
  }, [])

  const applyFailed = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      setError(message === UNREADABLE ? t('voiceAdmin.notLoaded') : message)
      setLoaded(false)
    },
    [t],
  )

  // The fetch lives in the effect; the button reuses the same two appliers so a
  // reload is not a second code path.
  useEffect(() => {
    let cancelled = false
    void Promise.all([loadVoiceSettings(), listAdminModels()])
      .then(([next, models]) => {
        if (!cancelled) applySettings(next, models)
      })
      .catch((err) => {
        if (!cancelled) applyFailed(err)
      })
    return () => {
      cancelled = true
    }
  }, [applySettings, applyFailed])

  const reload = () => {
    setError(null)
    setLoaded(false)
    void Promise.all([loadVoiceSettings(), listAdminModels()])
      .then(([next, models]) => applySettings(next, models))
      .catch(applyFailed)
  }

  const platformProviders = catalog.providers.filter((p) => p.scope === 'platform')
  const platformModels = catalog.models.filter((m) => m.scope === 'platform')

  // The built-in engine is a service of ours, so asking for a provider is noise:
  // the page finds it in the catalog by its address and points the tier at it.
  // Anything else would let an operator pick "built-in" and still dial LLMHub —
  // which is exactly how a dictation ended up answering 404.
  const builtInProvider = platformProviders.find((p) => (p.base_url ?? '').includes('nanoasr'))
  const usingBuiltIn = settings?.engine === 'local' && !!builtInProvider

  // Plain handler: this page re-renders with its own state anyway, and memoizing
  // it only fights the compiler's inference.
  const update = <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current))
  }

  const onCheckEngine = async () => {
    if (!settings?.providerId) return
    setChecking(true)
    setEngineModels(null)
    try {
      const result = await testAdminProvider({ id: Number(settings.providerId) })
      if (!result.ok) {
        toast.error(result.error ?? t('tests.failure'))
        return
      }
      setEngineModels(result.models ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const onSave = async () => {
    if (!settings) return
    setBusy(true)
    try {
      await saveVoiceSettings(settings)
      // A composer that is already open reads the settings once; dropping the
      // memo is what lets a reload pick the new ones up.
      resetVoiceConfigCache()
      toast.success(t('voiceAdmin.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const providerSelect = (value: string, onChange: (next: string) => void) => (
    <Select value={value ? value : NONE} onValueChange={(next) => onChange(next === NONE ? '' : next)}>
      <SelectTrigger>
        <SelectValue placeholder={t('voiceAdmin.providerPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('voiceAdmin.noModelId')}</SelectItem>
        {platformProviders.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4" data-voice-console="">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t('voiceAdmin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('voiceAdmin.description')}</p>
        <p className="text-xs text-muted-foreground">{t('voiceAdmin.pageHint')}</p>
      </div>

      {error ? (
        <VoiceCard title={t('voiceAdmin.loadFailed')}>
          <p className="text-sm text-destructive md:col-span-2">{error}</p>
          <div className="md:col-span-2">
            <Button variant="outline" onClick={reload}>
              {t('voiceAdmin.reload')}
            </Button>
          </div>
        </VoiceCard>
      ) : null}

      {settings ? (
        <>
          <VoiceCard title={t('voiceAdmin.realtimeTier')} hint={t('voiceAdmin.realtimeHint')}>
            <VoiceField label={t('voiceAdmin.engine')}>
              <Select
                value={settings.engine}
                onValueChange={(value) => {
                  const engine = value as RealtimeEngine
                  update('engine', engine)
                  if (engine === 'local' && builtInProvider) {
                    // Choosing the built-in engine is also choosing our own
                    // service; leaving the external provider in place would be a
                    // configuration that cannot work.
                    update('providerId', String(builtInProvider.id))
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t('voiceAdmin.engineLocal')}</SelectItem>
                  <SelectItem value="remote">{t('voiceAdmin.engineRemote')}</SelectItem>
                </SelectContent>
              </Select>
            </VoiceField>

            {usingBuiltIn ? (
              <VoiceField label={t('voiceAdmin.builtInService')}>
                <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                  {builtInProvider.name} · <span className="font-mono">{builtInProvider.base_url}</span>
                </p>
              </VoiceField>
            ) : (
              <VoiceField label={t('voiceAdmin.provider')}>
                {providerSelect(settings.providerId, (next) => update('providerId', next))}
              </VoiceField>
            )}

            {settings.engine === 'local' && !builtInProvider ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground md:col-span-2">
                {t('voiceAdmin.builtInMissing')}
              </p>
            ) : null}

            <VoiceField label={t('voiceAdmin.model')}>
              <Input
                value={settings.model}
                onChange={(event) => update('model', event.target.value)}
                placeholder={t('voiceAdmin.modelPlaceholder')}
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.language')}>
              <Input
                value={settings.language}
                onChange={(event) => update('language', event.target.value)}
                placeholder="zh"
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.prompt')}>
              <Input value={settings.prompt} onChange={(event) => update('prompt', event.target.value)} />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.maxSeconds')}>
              <Input
                inputMode="numeric"
                value={settings.maxSeconds}
                onChange={(event) => update('maxSeconds', event.target.value)}
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.commitIntervalMs')}>
              <Input
                inputMode="numeric"
                value={settings.commitIntervalMs}
                onChange={(event) => update('commitIntervalMs', event.target.value)}
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.audioRate')}>
              <Input
                inputMode="numeric"
                value={settings.audioRate}
                onChange={(event) => update('audioRate', event.target.value)}
                placeholder="24000"
              />
            </VoiceField>

            {/* Only the local engine has hotwords: sherpa takes them when it builds
                a recogniser, so a change here rebuilds them (never mid-dictation). */}
            {settings.engine === 'local' ? (
              <div className="md:col-span-2">
                <VoiceField label={t('voiceAdmin.hotwords')}>
                  <Textarea
                    rows={4}
                    value={settings.hotwords}
                    onChange={(event) => update('hotwords', event.target.value)}
                    placeholder={t('voiceAdmin.hotwordsPlaceholder')}
                  />
                </VoiceField>
                <p className="mt-1 text-xs text-muted-foreground">{t('voiceAdmin.hotwordsHint')}</p>
              </div>
            ) : null}

            {engineModels ? (
              <div className="text-xs text-muted-foreground md:col-span-2">
                {t('voiceAdmin.modelsFetched')}:{' '}
                {engineModels.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="mr-1 rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                    onClick={() => update('model', id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            ) : null}
          </VoiceCard>

          <VoiceCard
            title={t('voiceAdmin.batchTier')}
            hint={t('voiceAdmin.batchHint')}
            actions={<RecognitionTest target="batch" label={t('voiceAdmin.testBatch')} />}
          >
            <VoiceSwitch
              label={t('voiceAdmin.batchEnabled')}
              checked={settings.batchEnabled}
              onChange={(value) => update('batchEnabled', value)}
            />

            <VoiceField label={t('voiceAdmin.batchTrigger')}>
              <Select
                value={settings.batchTrigger}
                onValueChange={(value) => update('batchTrigger', value as BatchTrigger)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">{t('voiceAdmin.batchTriggerAlways')}</SelectItem>
                  <SelectItem value="manual">{t('voiceAdmin.batchTriggerManual')}</SelectItem>
                  <SelectItem value="empty">{t('voiceAdmin.batchTriggerEmpty')}</SelectItem>
                </SelectContent>
              </Select>
            </VoiceField>

            <VoiceField label={t('voiceAdmin.batchProvider')}>
              {providerSelect(settings.batchProviderId, (next) => update('batchProviderId', next))}
            </VoiceField>

            <VoiceField label={t('voiceAdmin.batchModel')}>
              <Input
                value={settings.batchModel}
                onChange={(event) => update('batchModel', event.target.value)}
                placeholder={t('voiceAdmin.batchModelPlaceholder')}
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.batchLanguage')}>
              <Input
                value={settings.batchLanguage}
                onChange={(event) => update('batchLanguage', event.target.value)}
                placeholder="zh"
              />
            </VoiceField>

            <VoiceField label={t('voiceAdmin.batchPrompt')}>
              <Input value={settings.batchPrompt} onChange={(event) => update('batchPrompt', event.target.value)} />
            </VoiceField>
          </VoiceCard>

          <VoiceCard
            title={t('voiceAdmin.polishTier')}
            actions={<RecognitionTest target="realtime" label={t('voiceAdmin.testRecognize')} />}
          >
            <VoiceSwitch
              label={t('voiceAdmin.polishEnabled')}
              checked={settings.polishEnabled}
              onChange={(value) => update('polishEnabled', value)}
            />

            <VoiceField label={t('voiceAdmin.polishModel')}>
              <Select
                value={settings.polishModelId ? settings.polishModelId : NONE}
                onValueChange={(value) => update('polishModelId', value === NONE ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('voiceAdmin.noModelId')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('voiceAdmin.noModelId')}</SelectItem>
                  {platformModels.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </VoiceField>

            <VoiceField label={t('voiceAdmin.polishThinking')}>
              <Select
                value={polishThinkingValue(settings.polishThinking)}
                onValueChange={(value) => update('polishThinking', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('voiceAdmin.polishThinkingOff')}</SelectItem>
                  <SelectItem value="low">{t('voiceAdmin.polishThinkingLow')}</SelectItem>
                  <SelectItem value="medium">{t('voiceAdmin.polishThinkingMedium')}</SelectItem>
                  <SelectItem value="high">{t('voiceAdmin.polishThinkingHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </VoiceField>

            <VoiceSwitch
              label={t('voiceAdmin.polishSkipAfterBatch')}
              checked={settings.polishSkipAfterBatch}
              onChange={(value) => update('polishSkipAfterBatch', value)}
            />

            <div className="md:col-span-2">
              <VoiceField label={t('voiceAdmin.polishPrompt')}>
                <Textarea
                  rows={3}
                  value={settings.polishPrompt}
                  onChange={(event) => update('polishPrompt', event.target.value)}
                />
              </VoiceField>
            </div>
          </VoiceCard>

          <VoiceCard title={t('voiceAdmin.shortcutTitle')} hint={t('voiceAdmin.shortcutHint')}>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <ShortcutCapture value={settings.shortcut} onChange={(spec) => update('shortcut', spec)} />
              <Button type="button" variant="outline" size="sm" onClick={() => update('shortcut', '')}>
                {t('voiceAdmin.shortcutClear')}
              </Button>
            </div>
          </VoiceCard>

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || !loaded} onClick={() => void onSave()}>
              {t('voiceAdmin.save')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={reload}>
              {t('voiceAdmin.reload')}
            </Button>
            <Button variant="outline" disabled={checking || !settings.providerId} onClick={() => void onCheckEngine()}>
              {checking ? t('tests.testing') : t('voiceAdmin.checkEngine')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default VoicePage
