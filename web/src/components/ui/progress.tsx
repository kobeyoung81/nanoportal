import { cn } from '../../lib/utils'

// 确定进度条。value 省略时是"不确定"（服务端还没给总数），用脉冲表示。
function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value?: number
  max?: number
  label?: string
  className?: string
}) {
  const pct = value == null ? undefined : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-[var(--ui-radius-pill)] bg-[var(--c-surface-2)]', className)}
    >
      <div
        className={cn(
          'h-full rounded-[var(--ui-radius-pill)] bg-[var(--c-accent)] transition-[width]',
          pct == null && 'w-1/3 animate-pulse',
        )}
        style={pct == null ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress }
