// The fetch/save half of the admin voice settings. The parsing lives in
// voiceSettings.ts so it stays testable without a DOM.

import { fetchJson, putJson } from './api'
import {
  UNREADABLE,
  VOICE_COMPONENT,
  parseVoiceSettings,
  settingsValues,
  type VoiceSettings,
} from './voiceSettings'

export { UNREADABLE, VOICE_COMPONENT, VOICE_KEYS, parseVoiceSettings, polishThinkingValue } from './voiceSettings'
export type { ConfigItem, VoiceSettings, RealtimeEngine, BatchTrigger } from './voiceSettings'

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const payload = await fetchJson<unknown>(`/configs/${VOICE_COMPONENT}`)
  const parsed = parseVoiceSettings(payload)
  if (!parsed) {
    throw new Error(UNREADABLE)
  }
  return parsed
}

/**
 * saveVoiceSettings writes every key. The config API takes one key per call, and
 * the bus upserts unknown keys, so a deploy that has not seeded one yet still
 * accepts the save.
 */
export async function saveVoiceSettings(settings: VoiceSettings): Promise<void> {
  for (const [key, value] of Object.entries(settingsValues(settings))) {
    await putJson(`/configs/${VOICE_COMPONENT}/${encodeURIComponent(key)}`, { value })
  }
}
