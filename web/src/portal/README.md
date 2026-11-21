# Portal plugins (P0)

`plugins.json` decides which panels exist and in which order the activity bar
shows them. A plugin from another application resolves through its manifest and a
runtime module load. The chat workbench is the workspace module's page and has no
shell copy: `/agent` is served by that plugin alone, and the route reports itself
unavailable when the plugin is missing.

## The three files that matter

| File | Role |
|---|---|
| `contract.ts` | The contract: `CONTRACT_VERSION`, `PanelContribution`, `PortalContext`. Types and constants only. |
| `plugins.json` | The shell's table. `shell.panels` is the activity-bar order; an entry with `manifest` is a remote plugin. |
| `registry.tsx` | `usePlugins()`: validates the table, fetches each remote manifest, turns panels into workbench plugins. |
| `remote.ts` | `parseRemoteManifest`: a manifest is untrusted input; a wrong version, a duplicate id, an unknown icon or a non-same-origin entry rejects the whole file. |
| `loader.ts` | `loadPanelComponent`: the single entry — `registerRemotes` + `loadRemote`, cached per entry/expose/export, 15 s timeout, failures retryable. |
| `RemotePanel.tsx` | The panel host: loading, error and retry, rendered inside the dock. A broken plugin stays a broken panel. |

## What "P0" and "P1" mean here

- **P0 (done)**: the table drives the panel list; implementations are static
  imports; the shell behaves exactly as before.
- **P1 (this release)**: `nanoartifacts` ships a Module Federation remote
  (`/nanoartifacts/plugins/nanoartifacts/remoteEntry.js`) and contributes two
  panels. `loadPlugin` is `loadRemote` for that entry; the call sites never know.

## Invariants with teeth

- **V-1** one panel id, one owner (`resolveShellPanels`; duplicates are refused).
- **V-3** a manifest whose `contract` is not this shell's is refused, and the
  error names both versions.
- **V-2** a remote bundle must not carry React (`shared` uses `import: false`;
  check `grep -rl "Minified React error"` in the remote's chunks is empty).
- Panel order is a product decision: `manifest.test.ts` pins the six shell ids.

## Adding a plugin later

1. The application publishes `<base>/plugin.json` (`contract`, `plugin`,
   `entry`, `panels`) and a federation remote exposing the panel components.
2. Add one entry to `plugins.json` with its `manifest` path.
3. Nothing in the shell's code changes. Contract changes are the only event that
   still needs a release window for the shell and every plugin.
