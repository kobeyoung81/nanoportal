// The admin capability page loads three catalogs at once. An empty catalog is a
// normal state — a fresh installation has no MCP servers, and built-in tools
// only appear once an agent has registered them — and the bus used to send such
// a list as null. Reading `.length` on that blanked the whole console.
//
// Normalising here keeps the page's state arrays, and the fix is one place
// instead of every render branch.
import type { BuiltinDef, McpDef, SkillDef } from './capabilities'

export type CapabilityLists = {
  servers: McpDef[]
  skills: SkillDef[]
  builtins: BuiltinDef[]
}

export function normalizeCapabilityLists(input: {
  servers?: McpDef[] | null
  skills?: SkillDef[] | null
  tools?: BuiltinDef[] | null
}): CapabilityLists {
  return {
    servers: input.servers ?? [],
    skills: input.skills ?? [],
    builtins: input.tools ?? [],
  }
}
