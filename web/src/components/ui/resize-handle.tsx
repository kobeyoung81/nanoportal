import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '../../lib/utils'
import { heightFromDrag, heightFromKey, type ResizeGrow } from '../../lib/resize'

/** A pointer move past this many pixels counts as a drag, not a tap. */
const DRAG_SLOP = 3
/** Two taps closer than this (in ms) are a double click. */
const DOUBLE_TAP_MS = 400

/**
 * A thin horizontal drag handle that reports a pixel height for the panel it
 * resizes. `expandBy` says which direction grows that panel, because both
 * layouts occur here: the git panel's change list hangs above a bottom-edge
 * handle and fills downward ("down"), while the docked history/tags/stashes
 * panels sit below a top-edge handle and pull upward ("up", the default).
 * Unlike `PanelResizeHandle` — which distributes percentages and therefore
 * needs a height-bounded parent — this works inside a scrolling container.
 *
 * The handle is focusable, supports the arrow keys for keyboard resizing, and
 * calls `onReset` on a double click (panels use it to go back to sizing
 * themselves from their content).
 */
export function HeightResizeHandle({
  value,
  min,
  max,
  onChange,
  expandBy = 'up',
  onReset,
  className,
  label,
  hint,
}: {
  /** Current height of the resized panel, in pixels. */
  value: number
  /** Smallest allowed height, in pixels. */
  min: number
  /** Largest allowed height, in pixels. */
  max: number
  /** Called with the clamped height while dragging or using the keyboard. */
  onChange: (px: number) => void
  /** Which drag direction makes the panel taller. */
  expandBy?: ResizeGrow
  /** Double-click action, e.g. "size the panel from its content again". */
  onReset?: () => void
  className?: string
  /** Accessible label, e.g. "Drag to resize the change list". */
  label?: string
  /** Tooltip text, e.g. what a double click does. */
  hint?: string
}) {
  const clamp = useCallback((px: number) => Math.min(Math.max(px, min), Math.max(min, max)), [min, max])
  // Timestamp of the previous tap, used to recognise a double click.
  const lastTapRef = useRef(0)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startValue = clamp(value)
    let dragged = false

    const onMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientY - startY) > DRAG_SLOP) {
        dragged = true
      }
      // Dragging the handle away from the panel grows it: downward for a
      // bottom-edge handle, upward for a top-edge one.
      onChange(clamp(heightFromDrag(expandBy, startValue, startY, moveEvent.clientY)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragged || !onReset) {
        lastTapRef.current = 0
        return
      }
      // Double click is detected from the taps themselves rather than from the
      // dblclick event: pointerdown is preventDefault-ed so a drag cannot
      // select page text, which makes the browser's own dblclick unreliable.
      const now = Date.now()
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0
        onReset()
        return
      }
      lastTapRef.current = now
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(clamp(heightFromKey(expandBy, value, event.key)))
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={hint ?? label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative h-[var(--ui-handle-h)] shrink-0 cursor-row-resize transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none active:bg-accent',
        className,
      )}
      style={{ touchAction: 'none' }}
    >
      <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 py-0.5 opacity-70 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"
      >
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
        <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
      </span>
    </div>
  )
}
