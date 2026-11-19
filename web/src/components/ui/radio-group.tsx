import * as React from 'react'
import { cn } from '../../lib/utils'

// 原生 radio：同一 name 自动成组、方向键切换由浏览器负责。
function RadioGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="radiogroup" className={cn('flex flex-col gap-2', className)} {...props} />
}

function Radio({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="radio"
      className={cn(
        'h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-[var(--c-border-strong)] bg-[var(--c-surface)]',
        'checked:border-[6px] checked:border-[var(--c-accent)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Radio, RadioGroup }
