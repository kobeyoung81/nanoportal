import * as React from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

// 单日期选择（不含时间）。value 用 ISO 的 YYYY-MM-DD，避免时区把日期挪一天。
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const parse = (value?: string) => {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

const MONTHS = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  className,
  id,
}: {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = parse(value)
  const [cursor, setCursor] = React.useState(() => selected ?? new Date())
  const rootRef = React.useRef<HTMLDivElement>(null)

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

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  // 周一开头：getDay() 的 0 是周日。
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const today = iso(new Date())

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ]

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className="ui-field items-center justify-between px-2 text-left focus-visible:outline-none"
      >
        <span className={cn('truncate text-xs', value ? 'text-[var(--c-text)]' : 'text-[var(--c-text-3)]')}>
          {value || placeholder}
        </span>
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--c-text-3)]" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="选择日期"
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-64 rounded-[var(--ui-radius-md)] border border-[var(--c-border)] bg-[var(--c-surface-3)] p-2 shadow-[var(--ui-shadow-2)]"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="rounded-[var(--ui-radius-sm)] p-1 text-[var(--c-text-2)] hover:bg-[var(--c-surface-2)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium">
              {year} 年 {MONTHS[month]}
            </span>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="rounded-[var(--ui-radius-sm)] p-1 text-[var(--c-text-2)] hover:bg-[var(--c-surface-2)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-[var(--c-text-3)]">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-0.5">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, index) => {
              if (day == null) return <span key={`empty-${index}`} />
              const date = iso(new Date(year, month, day))
              const active = value === date
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onChange(date)
                    setOpen(false)
                  }}
                  className={cn(
                    'h-7 rounded-[var(--ui-radius-sm)] text-xs tabular-nums transition-colors',
                    active
                      ? 'bg-[var(--c-accent)] text-[var(--c-on-accent)]'
                      : date === today
                        ? 'bg-[var(--c-accent-weak)] text-[var(--c-text)]'
                        : 'text-[var(--c-text-2)] hover:bg-[var(--c-surface-2)]',
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { DatePicker }
