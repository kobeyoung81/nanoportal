import * as React from 'react'
import { cn } from '../../lib/utils'

function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[20px] items-center justify-center rounded-[var(--ui-radius-sm)] border border-[var(--c-border)] border-b-2 bg-[var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--c-text-2)]',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
