import * as React from 'react'
import { cn } from '../../lib/utils'

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger' | 'info'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        variant === 'default' && 'border-transparent bg-primary text-primary-foreground',
        variant === 'secondary' && 'border-transparent bg-secondary text-secondary-foreground',
        variant === 'outline' && 'border-border text-foreground',
        variant === 'success' && 'border-transparent bg-success/15 text-success',
        variant === 'warning' && 'border-transparent bg-warning/15 text-warning',
        variant === 'danger' && 'border-transparent bg-danger/15 text-danger',
        variant === 'info' && 'border-transparent bg-info/15 text-info',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }
