import * as React from 'react'
import { cn } from '../../lib/utils'

// 单选分段控件（composer 的 Build/Plan 就是这一类，只是各自带色）。
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: React.ReactNode }[]
  onChange: (value: T) => void
  label?: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex items-center rounded-[var(--ui-radius-md)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 rounded-[calc(var(--ui-radius-md)-2px)] px-2.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-[var(--c-surface)] text-[var(--c-text)] shadow-[var(--ui-shadow-1)]'
                : 'text-[var(--c-text-2)] hover:text-[var(--c-text)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
