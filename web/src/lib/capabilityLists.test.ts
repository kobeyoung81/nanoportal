// A missing catalog is an empty catalog. The bus once sent `tools: null` on a
// fresh installation, and the page read `.length` on it.
import { describe, expect, it } from 'vitest'
import { normalizeCapabilityLists } from './capabilityLists'
import type { BuiltinDef, McpDef, SkillDef } from './capabilities'

const mcp = { id: 'm', scope: 'platform', name: 'M', description: '', transport: 'http', default_enabled: true, locked: '' } as McpDef
const skill = { id: 's', scope: 'platform', name: 'S', description: '', files: {}, default_enabled: true, locked: '' } as SkillDef
const tool = { id: 'read', description: 'read a file', default_enabled: true } as BuiltinDef

describe('normalizeCapabilityLists', () => {
  it('reads a missing list as empty', () => {
    expect(normalizeCapabilityLists({ servers: null, skills: null, tools: null })).toEqual({
      servers: [],
      skills: [],
      builtins: [],
    })
    expect(normalizeCapabilityLists({})).toEqual({ servers: [], skills: [], builtins: [] })
  })

  it('keeps the arrays it was given', () => {
    expect(normalizeCapabilityLists({ servers: [mcp], skills: [skill], tools: [tool] })).toEqual({
      servers: [mcp],
      skills: [skill],
      builtins: [tool],
    })
  })

  it('normalises one missing field without touching the others', () => {
    const lists = normalizeCapabilityLists({ servers: [mcp], skills: undefined, tools: [tool] })
    expect(lists.servers).toEqual([mcp])
    expect(lists.skills).toEqual([])
    expect(lists.builtins).toEqual([tool])
  })
})
