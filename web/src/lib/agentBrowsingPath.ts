import { readRawState, writeRawState } from './clientState'

// Browsing paths are remembered per agent: switching agents must not carry one
// agent's directory into a container that may not have it (that is what parked
// the file panel on a raw "no such file or directory" error).
//
// The two browsers root their trees differently and therefore keep separate
// maps: the file panel's paths are relative to the agent home ("" is that home
// itself), while the git browser's are relative to the data root ("" is the
// data root, and the agent home is "agents/<home>").

export type PathArea = 'gitBrowser' | 'fileBrowser'

/** The storage slice both areas keep their per-agent map in. */
const PATH_SUFFIX = 'pathByAgent'

/** Sets one agent's remembered path ("" is a real value, see readAgentPath). */
export function setAgentPath(map: Record<string, string>, agentId: string, path: string): Record<string, string> {
  return { ...map, [agentId]: path }
}

function readPathMap(area: PathArea): Record<string, string> {
  const raw = readRawState(area, PATH_SUFFIX)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * The directory this agent was last browsing, or null when it has none. An
 * explicit "" is a real entry — the data root in the git browser — which is why
 * "nothing remembered" and "remembered the root" are different answers.
 */
export function readAgentPath(area: PathArea, agentId: string | null): string | null {
  if (!agentId) {
    return null
  }
  return readPathMap(area)[agentId] ?? null
}

export function writeAgentPath(area: PathArea, agentId: string | null, path: string): void {
  if (!agentId) {
    return
  }
  writeRawState(area, PATH_SUFFIX, JSON.stringify(setAgentPath(readPathMap(area), agentId, path)))
}

/**
 * Which path survives when a remembered directory cannot be read. A missing
 * directory must not park the browser on a raw server error, but only a
 * reachable default root proves it is really gone: a restarting container or a
 * failing tunnel must keep the user's place rather than silently move it.
 */
export function fallbackTarget(remembered: string | null, defaultRootReadable: boolean): 'remembered' | 'default' {
  if (remembered === null) {
    return 'default'
  }
  return defaultRootReadable ? 'default' : 'remembered'
}
