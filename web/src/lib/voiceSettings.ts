// The platform-wide settings of the composer's dictation, and how they are read
// back. Kept apart from the fetch/save calls (voiceAdmin.ts) so the parsing —
// the part that once showed defaults over a saved configuration — is testable
// without a DOM.
//
// Three tiers live here, matching the bus's voice.Config:
//
//	realtime  what the composer streams into: an external realtime provider;
//	batch     a second, higher-accuracy pass over the whole take, run by an
//	          external file-transcription model;
//	polish    the chat model that rewrites the winning transcript.
//
// Reading is the awkward half: the portal's admin config route answers from its
// own repository as `{component_type, updated_at, config:{key: value}}`, while
// the bus answers the same question as `{component_type, items:[{key, value}]}`.
// parseVoiceSettings accepts both, and reports "unreadable" rather than
// inventing defaults — a write on top of invented defaults is what silently
// blanked this configuration once.

export const VOICE_COMPONENT = 'voice'

/** UNREADABLE is reported when the saved settings cannot be read at all. */
export const UNREADABLE = 'unreadable'

export type ConfigItem = {
  key: string
  value: string
  value_type: string
  description: string
}

/** BatchTrigger says when the whole-recording pass runs. */
export type BatchTrigger = 'always' | 'manual' | 'empty'

// Form state keeps every value as a string: it is what the config API stores,
// and the bus parses and clamps numbers on read.
export type VoiceSettings = {
  enabled: boolean
  /** The platform's default dictation shortcut, e.g. "Alt+M"; empty = none. */
  shortcut: string
  // Tier 1: realtime.
  providerId: string
  model: string
  language: string
  prompt: string
  maxSeconds: string
  commitIntervalMs: string
  // Tier 2: the batch pass.
  batchEnabled: boolean
  batchTrigger: BatchTrigger
  batchProviderId: string
  batchModel: string
  batchLanguage: string
  batchPrompt: string
  // Tier 3: polish.
  polishEnabled: boolean
  polishModelId: string
  polishPrompt: string
  /** "none" = explicitly off; else low | medium | high. */
  polishThinking: string
  polishSkipAfterBatch: boolean
}

export const VOICE_KEYS = {
  enabled: 'enabled',
  shortcut: 'shortcut',
  providerId: 'realtime.providerId',
  model: 'realtime.model',
  language: 'realtime.language',
  prompt: 'realtime.prompt',
  maxSeconds: 'realtime.maxSeconds',
  commitIntervalMs: 'realtime.commitIntervalMs',
  batchEnabled: 'batch.enabled',
  batchTrigger: 'batch.trigger',
  batchProviderId: 'batch.providerId',
  batchModel: 'batch.model',
  batchLanguage: 'batch.language',
  batchPrompt: 'batch.prompt',
  polishEnabled: 'polish.enabled',
  polishModelId: 'polish.modelId',
  polishPrompt: 'polish.prompt',
  polishThinking: 'polish.thinking',
  polishSkipAfterBatch: 'polish.skipAfterBatch',
} as const

/** configValueMap flattens either payload shape into key → value. */
function configValueMap(payload: unknown): Record<string, string> | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>

  if (record.config && typeof record.config === 'object' && !Array.isArray(record.config)) {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(record.config as Record<string, unknown>)) {
      out[key] = value === null || value === undefined ? '' : String(value)
    }
    return out
  }

  if (Array.isArray(record.items)) {
    const out: Record<string, string> = {}
    for (const item of record.items) {
      if (!item || typeof item !== 'object') {
        continue
      }
      const entry = item as Partial<ConfigItem>
      if (typeof entry.key === 'string') {
        out[entry.key] = typeof entry.value === 'string' ? entry.value : ''
      }
    }
    return out
  }

  return null
}

/**
 * parseVoiceSettings reads the saved settings out of either payload shape, or
 * returns null when the payload carries no recognisable voice keys at all.
 * Returning null (rather than defaults) is what keeps the card from writing an
 * empty configuration over a good one.
 */
export function parseVoiceSettings(payload: unknown): VoiceSettings | null {
  const map = configValueMap(payload)
  if (!map) {
    return null
  }
  if (!Object.values(VOICE_KEYS).some((key) => key in map)) {
    return null
  }
  return {
    enabled: (map[VOICE_KEYS.enabled] ?? 'false') === 'true',
    shortcut: map[VOICE_KEYS.shortcut] ?? 'Alt+M',
    providerId: map[VOICE_KEYS.providerId] ?? '',
    model: map[VOICE_KEYS.model] ?? '',
    language: map[VOICE_KEYS.language] ?? '',
    prompt: map[VOICE_KEYS.prompt] ?? '',
    maxSeconds: map[VOICE_KEYS.maxSeconds] ?? '120',
    commitIntervalMs: map[VOICE_KEYS.commitIntervalMs] ?? '0',
    batchEnabled: (map[VOICE_KEYS.batchEnabled] ?? 'false') === 'true',
    batchTrigger: parseTrigger(map[VOICE_KEYS.batchTrigger]),
    batchProviderId: map[VOICE_KEYS.batchProviderId] ?? '',
    batchModel: map[VOICE_KEYS.batchModel] ?? '',
    batchLanguage: map[VOICE_KEYS.batchLanguage] ?? '',
    batchPrompt: map[VOICE_KEYS.batchPrompt] ?? '',
    polishEnabled: (map[VOICE_KEYS.polishEnabled] ?? 'true') === 'true',
    polishModelId: map[VOICE_KEYS.polishModelId] ?? '',
    polishPrompt: map[VOICE_KEYS.polishPrompt] ?? '',
    polishThinking: map[VOICE_KEYS.polishThinking] ?? '',
    polishSkipAfterBatch: (map[VOICE_KEYS.polishSkipAfterBatch] ?? 'false') === 'true',
  }
}

/** parseTrigger mirrors the bus: an unrecognized value means "always". */
function parseTrigger(value: string | undefined): BatchTrigger {
  return value === 'manual' || value === 'empty' ? value : 'always'
}

/** POLISH_THINKING_LEVELS are the reasoning caps the polish pass accepts.
 * "none" is the explicit off — the bus sends it as reasoning_effort=none,
 * because leaving the parameter out still lets a reasoning model think. */
export const POLISH_THINKING_LEVELS = ['none', 'low', 'medium', 'high'] as const

export type PolishThinking = (typeof POLISH_THINKING_LEVELS)[number]

/** polishThinkingValue reads a stored value as a level the bus understands.
 * Anything else — including the empty value an unedited row holds — is "none",
 * which is both what the select shows and what saving writes back. */
export function polishThinkingValue(raw: string): PolishThinking {
  const value = raw.trim().toLowerCase()
  return (POLISH_THINKING_LEVELS as readonly string[]).includes(value) ? (value as PolishThinking) : 'none'
}

/** settingsValues is the key → stored-value view written back on save. */
export function settingsValues(settings: VoiceSettings): Record<string, string> {
  return {
    [VOICE_KEYS.enabled]: settings.enabled ? 'true' : 'false',
    [VOICE_KEYS.shortcut]: settings.shortcut.trim(),
    [VOICE_KEYS.providerId]: settings.providerId,
    [VOICE_KEYS.model]: settings.model.trim(),
    [VOICE_KEYS.language]: settings.language.trim(),
    [VOICE_KEYS.prompt]: settings.prompt.trim(),
    [VOICE_KEYS.maxSeconds]: settings.maxSeconds.trim(),
    [VOICE_KEYS.commitIntervalMs]: settings.commitIntervalMs.trim(),
    [VOICE_KEYS.batchEnabled]: settings.batchEnabled ? 'true' : 'false',
    [VOICE_KEYS.batchTrigger]: settings.batchTrigger,
    [VOICE_KEYS.batchProviderId]: settings.batchProviderId,
    [VOICE_KEYS.batchModel]: settings.batchModel.trim(),
    [VOICE_KEYS.batchLanguage]: settings.batchLanguage.trim(),
    [VOICE_KEYS.batchPrompt]: settings.batchPrompt.trim(),
    [VOICE_KEYS.polishEnabled]: settings.polishEnabled ? 'true' : 'false',
    [VOICE_KEYS.polishModelId]: settings.polishModelId,
    [VOICE_KEYS.polishPrompt]: settings.polishPrompt,
    [VOICE_KEYS.polishThinking]: polishThinkingValue(settings.polishThinking),
    [VOICE_KEYS.polishSkipAfterBatch]: settings.polishSkipAfterBatch ? 'true' : 'false',
  }
}
