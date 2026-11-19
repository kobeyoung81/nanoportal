import * as React from 'react'
import { cn } from '../../lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-[var(--ui-radius-md)] bg-muted', className)} {...props} />
}

export { Skeleton }
