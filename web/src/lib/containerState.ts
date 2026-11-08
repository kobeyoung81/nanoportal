// Which row actions the admin user detail page offers for a container request.
//
// The bus owns the real rules: it only revives a disposed or failed request, and
// only restarts a running one. The buttons used to be rendered unconditionally,
// so "Reprovision" showed up next to a live container and the click returned a
// 404. Keeping the three conditions here — pure functions of the status — lets
// the page ask the same question the bus will answer, and lets a unit test pin
// the matrix instead of a browser.
//
// Statuses mirror `container_requests.status` (nanobus migrations 002 + 029):
// pending → creating → running, with failed, restarting, disposing and disposed.

const LIVE_CONTAINER_STATUSES = new Set(['pending', 'creating', 'running', 'suspended'])
const REPROVISIONABLE_CONTAINER_STATUSES = new Set(['disposed', 'failed'])

/** Deprovision is offered while the container still occupies its slot. */
export function canDispose(status: string): boolean {
  return LIVE_CONTAINER_STATUSES.has(status)
}

/** In-place restart only makes sense for a running container. */
export function canRestart(status: string): boolean {
  return status === 'running'
}

/** The bus only revives a disposed or failed request (ReprovisionContainerRequest). */
export function canReprovision(status: string): boolean {
  return REPROVISIONABLE_CONTAINER_STATUSES.has(status)
}
