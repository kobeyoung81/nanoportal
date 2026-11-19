import * as React from 'react'
import { cn } from '../../lib/utils'

// 轻量浮层：没有引入新依赖（仓库里没有 radix popover），
// 只做三件事——点外面关、Esc 关、把内容定位在触发元素下方。
function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: {
  trigger: React.ReactElement
  children?: React.ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={rootRef} className="relative inline-flex">
      {React.cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
        onClick: (event: React.MouseEvent) => {
          const original = (trigger.props as { onClick?: (event: React.MouseEvent) => void }).onClick
          original?.(event)
          setOpen((value) => !value)
        },
        'aria-expanded': open,
        'aria-haspopup': true,
      })}
      {open ? (
        <div
          role="dialog"
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 min-w-[12rem] rounded-[var(--ui-radius-md)] border border-[var(--c-border)] bg-[var(--c-surface-3)] p-1 shadow-[var(--ui-shadow-2)]',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}

export { Popover }
