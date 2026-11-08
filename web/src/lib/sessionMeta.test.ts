// The `meta` blob's compaction marker: what makes a reload mid-compaction show
// the divider again, since the row's own divider only lands when the summary is
// in.
//
// api.ts is mocked so this stays a pure parse test: the real module pulls in the
// i18n singleton, which touches the DOM at import time.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ readAgentSessionMeta: vi.fn() }))

import { parseSessionMeta } from './sessionMeta'

describe('parseSessionMeta', () => {
  it('reads the compaction marker', () => {
    expect(parseSessionMeta(JSON.stringify({ _compacting: 'true' })).compacting).toBe(true)
  })

  it('treats any other value as not compacting', () => {
    expect(parseSessionMeta(JSON.stringify({ _compacting: 'false' })).compacting).toBe(false)
    expect(parseSessionMeta(JSON.stringify({})).compacting).toBe(false)
    expect(parseSessionMeta(undefined).compacting).toBe(false)
  })

  it('survives a malformed blob', () => {
    expect(parseSessionMeta('{not json').compacting).toBe(false)
  })

  it('reads the session agent the last turn ran', () => {
    // The conversation's own build/plan answer (lib/agentMode maps it to a mode).
    expect(parseSessionMeta(JSON.stringify({ _session_agent: 'plan' })).sessionAgent).toBe('plan')
  })

  it('reports no session agent when the key is absent', () => {
    // A session that has not run a turn yet has none — the caller must be able to
    // tell that from an empty answer, not read it as build.
    expect(parseSessionMeta(JSON.stringify({})).sessionAgent).toBeUndefined()
    expect(parseSessionMeta(undefined).sessionAgent).toBeUndefined()
    expect(parseSessionMeta('{not json').sessionAgent).toBeUndefined()
  })
})
