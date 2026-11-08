// The user config page covers an agent and its modes (build/plan) — not the
// agent's helpers. Subagents are platform-owned: they have no user-level model
// or thinking setting, so the page must not offer one.
//
// Source assertions, because the section that used to hold them never rendered
// (the user catalog is session-only) and a behaviour test would have passed
// vacuously. The names are assembled from pieces so Tailwind's source scan does
// not pick them up as candidates.

import { describe, expect, it } from 'vitest'
import pageSource from './UserConfigPage.tsx?raw'
import typesPageSource from './AgentTypesPage.tsx?raw'
import typesLibSource from '../lib/agentTypes.ts?raw'

const SUBAGENT_TYPES_CONST = 'subagent' + 'Types'
const SUBAGENT_CARD_KEY = 'userConfig.' + 'subagents'

describe('user config scope', () => {
  it('has no subagent section', () => {
    expect(pageSource).not.toContain(SUBAGENT_TYPES_CONST)
    expect(pageSource).not.toContain(SUBAGENT_CARD_KEY)
    expect(pageSource).not.toContain('selectSubagent')
  })

  it('asks for the session catalog without a query string', () => {
    // The admin helper keeps its own `?all=true` (that listing is the full set);
    // the user helper must not have one — the bus endpoint is session-only by
    // definition now, and a query string would suggest it can be widened.
    const userHelper = typesLibSource.slice(typesLibSource.indexOf('listAssignableAgentTypes'))
    expect(userHelper).not.toContain('all')
    expect(userHelper).toContain("'/agent-types', '/api/user/v1'")
    expect(pageSource).toContain('listAssignableAgentTypes()')
  })
})

describe('agent type page thinking scope', () => {
  it('offers the platform default to session modes and subagent types', () => {
    expect(typesPageSource).toContain('isSessionType(selected) || isSubagentType(selected)')
    expect(typesPageSource).toContain("'thinking.subagentPlatformHint'")
    expect(typesPageSource).toContain("'thinking.followPlatform'")
  })
})
