import * as React from 'react'
import { Card, CardContent } from './card'
import { Skeleton } from './skeleton'
import { cn } from '../../lib/utils'

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  loading = false,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: React.ReactNode
  sub?: React.ReactNode
  loading?: boolean
  className?: string
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-20" />
          ) : (
            <p className="mt-0.5 truncate text-2xl font-semibold leading-tight tracking-tight">{value ?? '–'}</p>
          )}
          {sub ? <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export { MetricCard }
