import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getToken } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'
import { shouldResetFrame } from './artifactsFrame'

// The library is its own front end, served and deployed by nanoartifacts. The
// portal only frames it and hands over the three things it cannot get itself:
// the user's token, the language and the theme.
//
// Same-origin framing (nginx proxies /artifacts/ to the service) means no CORS,
// no third-party cookies and no origin allowlist — but the token still travels
// by postMessage rather than a query string, which would land in logs and
// referrers.
const LOAD_TIMEOUT_MS = 15_000

function workHashFromQuery(): string {
  const params = new URLSearchParams(window.location.search)
  const work = params.get('work')
  if (work) return `#/w/${encodeURIComponent(work)}`
  const space = params.get('space')
  if (space) {
    const node = params.get('node')
    return node
      ? `#/s/${encodeURIComponent(space)}/n/${encodeURIComponent(node)}`
      : `#/s/${encodeURIComponent(space)}`
  }
  return ''
}

// portalPathFor turns the framed app's route into the portal's own URL. The
// portal route is what keeps the chrome (top bar, navigation) on a refresh or
// in a new tab; the service's hash form is internal to the frame.
function portalPathFor(hash: string): string {
  const decode = (raw: string) => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  const work = /^#\/w\/([^/?#]+)/.exec(hash) || /^#\/works\/([^/?#]+)/.exec(hash)
  if (work) return `/artifacts?work=${encodeURIComponent(decode(work[1]))}`

  const space = /^#\/s\/([^/?#]+)(?:\/n\/([^/?#]+))?/.exec(hash)
  if (space) {
    const base = `/artifacts?space=${encodeURIComponent(decode(space[1]))}`
    return space[2] ? `${base}&node=${encodeURIComponent(decode(space[2]))}` : base
  }
  return '/artifacts'
}

export function ArtifactsPage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const frameRef = useRef<HTMLIFrameElement>(null)

  // The framed app routes on the fragment, so a deep link is just the parent's
  // hash carried into the iframe's URL. The src stays fixed after mount: if it
  // followed the address bar, every internal navigation would reload the frame
  // and throw away the user's place.
  //
  // ?work= is the other door in: a link pasted by someone who has no session yet
  // lands here after signing in, and the work it names is opened in the frame.
  const [initialSrc] = useState(
    () => `/nanoartifacts/?embed=1${window.location.hash || workHashFromQuery()}`,
  )

  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  const sendInit = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      {
        type: 'nanoartifacts.init',
        token: getToken(),
        locale: i18n.language,
        theme: resolvedTheme,
      },
      window.location.origin,
    )
  }, [i18n.language, resolvedTheme])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!ready) setTimedOut(true)
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  // The framed app owns its routing; the address bar follows so a refresh or a
  // copied link lands on the same work. history.replaceState is used instead of
  // the router: a router navigation would re-render this page and reload the
  // frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; hash?: string } | null
      if (!data || data.type !== 'nanoartifacts.path' || typeof data.hash !== 'string') return
      // Replace through the router, not history.replaceState: the router's
      // location has to move too, otherwise clicking the top-level "Library"
      // link looks like a navigation to the page we are already on and the
      // frame never returns to the list. The frame's src is held in a ref, so
      // this re-render does not reload it.
      navigate(portalPathFor(data.hash), { replace: true })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [navigate])

  // Clicking the top-level "Library" link while already inside the library means
  // "go to the list", not "stay on this work". The router tells us when that
  // navigation happened; replaceState (used for frame-internal moves) does not.
  // Only the bare route qualifies — see shouldResetFrame for why every query
  // parameter (including ?space=) must be left alone.
  useEffect(() => {
    if (!ready || !shouldResetFrame(pathname, search)) return
    frameRef.current?.contentWindow?.postMessage(
      { type: 'nanoartifacts.navigate', hash: '#/' },
      window.location.origin,
    )
  }, [ready, pathname, search])

  useEffect(() => {
    if (ready) sendInit()
  }, [ready, sendInit])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <iframe
        ref={frameRef}
        src={initialSrc}
        title={t('nav.artifacts')}
        className="h-full w-full border-0"
        onLoad={() => {
          setReady(true)
          setTimedOut(false)
          sendInit()
        }}
      />

      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background">
          <Spinner label={t('artifactsFrame.loading')} />
        </div>
      ) : null}

      {timedOut ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
          <p className="text-sm text-muted-foreground">{t('artifactsFrame.unavailable')}</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            {t('artifactsFrame.reload')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
