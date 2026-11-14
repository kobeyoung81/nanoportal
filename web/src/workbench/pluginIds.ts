// Panel ids that changed, so a layout stored by an older build still finds its
// panels.
//
// A plugin id is what the persisted workbench layout stores (each dock's tabs
// and active tag, plus the last slot per panel) and what the phone's tab set
// stores. Renaming one without this map would leave every existing browser
// holding an id no plugin declares: the dock would keep the tag and render
// nothing, and the panel would look like it vanished.
//
// The map is applied when the stored payload is read, so the next write records
// the canonical ids and the alias only ever serves old payloads.
const ALIASES: Record<string, string> = {
  // "Agent Config" became "User Config": the panel grew account-level sections
  // (the capability library, preferences) and only one of its tabs is per agent.
  'agent-config': 'user-config',
  // The git browser became a workspace plugin: the panel id gained its module.
  'git-browser': 'workspace.git',
}

/** canonicalPanelId maps a stored panel id onto the id the manifest declares. */
export function canonicalPanelId(id: string): string {
  return ALIASES[id] ?? id
}
