# nanoportal

The console: one shell, one origin, and every module's screens inside it.

It is one of the eight first-class services. It serves the front end, owns the
session projection and the agent rows, and hosts the panels other modules
contribute.

## What it is

- **A single shell.** Chat, agents, the work library and the admin screens arrive as
  plugins from their own modules; the shell decides where they mount.
- **A workbench.** Draggable, resizable panels that keep their layout per person and
  follow the theme and language of the shell.
- **Self-service pages.** Your account, your agents, your container, your files.
- **The projection.** Conversation metadata for the sidebar — rebuildable from the
  transcripts that live in the agents' volumes.
- **The front door.** nginx serves the static assets and routes each API prefix to
  the module that owns it; only this port is published to the host.

## Where it sits

| | |
|---|---|
| Collections | `portal_agents`, `portal_agent_groups`, `portal_sessions`, `portal_binding_preferences` |
| Port | `80` in the network, `14403` on the host — the only one published |
| Contributes | the shell, the plugin registry, the route table, the design system |
| Reads from | `nanoauth` (tokens), `nanoadmin` (configuration), `nanobus` (messages), and the modules behind their APIs |

## Quick start

```bash
# the backend
cd server && go build ./cmd/nanoportal
NANOPORTAL_MONGO_URI="mongodb://localhost:27017/nanosec" \
NANO_PORTAL_BUS_URL="http://localhost:9000" \
NANOSEC_ADMIN_URL="http://localhost:14404" \
NANOSEC_BUS_INTERNAL_TOKEN="…" \
  ./nanoportal

# the front end
cd web && npm install && npm run dev      # vite, proxying to the backend
```

In a deployment the image builds the front end, runs the backend on `127.0.0.1:8080`
and puts nginx in front, so `/`, `/api/*` and `/plugins/*` share one origin.

## Configuration

| Variable | Meaning |
|---|---|
| `NANOPORTAL_MONGO_URI` | The platform database (its `portal_` prefix) |
| `NANO_PORTAL_BUS_URL` | The bus, for messages and the event stream |
| `NANOSEC_ADMIN_URL` | Configuration and the catalogue |
| `NANO_PORTAL_AUTH_URL` / `NANO_PORTAL_JWKS_URL` | Identity |
| `NANOSEC_BUS_INTERNAL_TOKEN` | Shared secret for every internal surface |

## Design decisions

- **The shell owns the frame, the modules own the screens.** A module ships a
  plugin manifest and a bundle; the shell installs it from `/plugins/<id>/`. Adding
  a screen does not mean rebuilding the console.
- **One origin.** The nginx in this image routes each API prefix to its module and
  mounts the plugins, so the browser never talks to a second host — no CORS, no
  cross-site cookie.
- **The projection is disposable.** `portal_sessions` carries what the sidebar needs;
  if it is wrong, it is rebuilt from the agents' transcripts, which are the authority.
- **The agent rows are here.** Who owns an agent, and which group it belongs to, is a
  console concern — other modules ask this one, they do not read `portal_*`.

## Docs

- [`docs/ARCHITECTURE.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/ARCHITECTURE.md) — the platform and the plugin model
- [`docs/MANAGEMENT_PORTAL_DESIGN.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/MANAGEMENT_PORTAL_DESIGN.md) — the console's screens and roles
- [`docs/README.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/docs/README.md) — every document

## Status

Released as part of `v0.1.0`; the version of this module is pinned in the
super-repo's `versions.lock`.

## Contributing and security

[`CONTRIBUTING.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/CONTRIBUTING.md)
for setup and commit rules; report vulnerabilities privately through
[`SECURITY.md`](https://gitee.com/kobeyoung81/nanosec/blob/master/SECURITY.md), never
in a public issue.

## License

[AGPL-3.0](./LICENSE). The name and logo are covered separately — see
[`NOTICE`](./NOTICE).
