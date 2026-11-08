// The framed library owns its own routing; the portal shell only mirrors the
// address bar and, on one occasion, talks back.
//
// That occasion is the top-level "Library" link: clicking it while already
// inside the library means "go back to the list", and the router reports it as
// a navigation to the bare route. Every other visit to /artifacts carries a
// query parameter the frame itself reported (?work=…, ?space=…, ?node=…), and
// echoing "back to the list" at those is what made a space impossible to open:
// the frame navigated to #/s/<id>, the shell mirrored it as ?space=<id>, the
// effect fired again and sent the frame back to #/.
//
// So the rule is the negative of what it was: only a bare /artifacts with no
// query at all is an instruction to reset the frame.
export function shouldResetFrame(pathname: string, search: string): boolean {
  if (pathname !== '/artifacts') return false
  return new URLSearchParams(search).toString() === ''
}
