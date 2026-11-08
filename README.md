# nanoportal

Web portal for MyriadMind — a React (Vite + TypeScript) UI served by a Go backend behind nginx. The UI is split into two surfaces:

- **User surface** (default): chat-first, no sidebar. Landing on `/chat` with a resizable workspace browser on the right, plus `/me` (self-service account / agent / container management) and `/workspace` (full-page self workspace with file upload/download).
- **Admin Panel** (lazy-loaded, reached via the "Admin Panel" button in the top-right for `operator`/`auditor`/`support`/`admin` roles): overview, components, users & agents, configs, audit, alerts, and the cross-user workspace browser under `/admin/*`.

`nanoportal` can be shipped as a single Docker container with:

- the React frontend prebuilt into static assets,
- the Go backend listening only on `127.0.0.1:8080`, and
- nginx serving the SPA on port `80` while proxying `/api/*` and `/healthz`.

## Features

- **Authentication** — login / register pages backed by nanoauth (JWT); the access
  token is reused for the chat WebSocket
- **Chat** — browser chat with agents (streaming via the gateway web channel),
  with session management and a resizable per-agent workspace browser
- **My account** — self-service management: own agents (create/edit/delete/restart),
  own container restart, own workspace
- **Overview** — dashboard with component status, user counts, and alert rules (admin)
- **Users** — list/search users, view user details (bindings, agents, status, tier) (operator+)
- **Configs** — read/edit service config items (`bus`, `gateway`, `runner`, `agent`, `auth`) (operator+)
- **Audit** — enterprise audit trail (operator+)
- **Alerts** — operator-defined alert rules
- **Workspace** — hypervisor workspace browser; cross-user browse (operator+), self browse + file upload/download (owner)
- **Container ops** — dispose a user's agent container (operator+)

> Newly registered nanoauth accounts have the read-only `user` role and land on the
> user surface (Chat / My account / Workspace). The Admin Panel button only appears
> for `operator`, `support`, `auditor`, and `admin` roles, and the backend enforces
> per-route permissions regardless of what the UI shows.

## API namespaces

The backend exposes two namespaces behind the same `/api` prefix (nginx proxies both):

- `/api/user/v1` — anything a general user needs: `auth/*`, `me`, `me/detail`,
  `me/agents`, `me/container/restart`, agent CRUD + sessions, and the workspace
  browser + `file` download (owner-or-operator) / upload (owner-only).
- `/api/admin/v1` — operational views: `overview`, `components`, `users*`, `configs*`,
  `audit`, `alert-rules`, `runners`, `containers/{userID}/dispose|restart`.

## Configuration

Runtime configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NANO_PORTAL_BUS_URL` | `http://127.0.0.1:9000` | nanobus HTTP base URL (also proxies `/auth/v1/*` to nanoauth) |
| `NANOSEC_BUS_INTERNAL_TOKEN` | (empty) | shared token every component presents to the bus's internal endpoints |
| `NANO_PORTAL_HYPERVISOR_URL` | `http://127.0.0.1:9090` | nanosec hypervisor base URL |
| `NANO_PORTAL_JWKS_URL` | `{NANO_PORTAL_BUS_URL}/auth/v1/.well-known/jwks` | nanoauth JWKS endpoint for token validation |

## Build

```bash
docker build -t nanoportal .
```

## Run

The portal has no database of its own: it reads everything through the bus, so
the bus (and the token it presents) is the whole configuration.

```bash
docker run --name nanoportal \
  -p 80:80 \
  -e 'NANO_PORTAL_BUS_URL=http://nanobus:9000' \
  -e 'NANO_PORTAL_HYPERVISOR_URL=http://nanosec:9090' \
  -e 'NANOSEC_BUS_INTERNAL_TOKEN=<the deployment's shared token>' \
  nanoportal
```

Use the same host names the rest of the deployment uses for the bus and the
hypervisor; from inside a container on the compose network those are
`nanobus:9000` and `nanosec:9090`.

## Local development

- Start the backend with `NANO_PORTAL_BUS_URL=http://127.0.0.1:9000 go run ./server/cmd/nanoportal`
  (add `NANOSEC_BUS_INTERNAL_TOKEN=...` when the bus enforces one).
- Start the frontend with `cd web && npm ci && npm run dev`.

Vite proxies `/api/*` and `/healthz` to `127.0.0.1:8080`, so the browser no longer needs a separate API base URL configuration.
