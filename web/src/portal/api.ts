// The data client a page gets.
//
// Every call carries the caller's token (the same client the shell uses, so a
// refresh and a 401 are handled once), and the default base is the portal's
// console surface — the data most pages show. A page that talks to another module
// names it through `bases` instead of spelling a URL.

import type { PortalApi } from './contract'
import {
  ADMIN_API_BASE,
  PORTAL_ADMIN_API_BASE,
  USER_API_BASE,
  deleteJson,
  fetchJson,
  patchJson,
  postJson,
} from '../lib/api'

export const portalApi: PortalApi = {
  get: (path, base) => fetchJson(path, base ?? PORTAL_ADMIN_API_BASE),
  post: (path, body, base) => postJson(path, body, base ?? PORTAL_ADMIN_API_BASE),
  patch: (path, body, base) => patchJson(path, body, base ?? PORTAL_ADMIN_API_BASE),
  del: (path, base) => deleteJson(path, base ?? PORTAL_ADMIN_API_BASE),
  bases: { portalConsole: PORTAL_ADMIN_API_BASE, admin: ADMIN_API_BASE, user: USER_API_BASE },
}
