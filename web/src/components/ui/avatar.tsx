import { cn } from '../../lib/utils'

const SIZE = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-[11px]',
  lg: 'h-9 w-9 text-sm',
}

// 首字母头像；没有名字时退回到图标位。永远不用渐变（克制的用法）。
function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name?: string | null
  src?: string
  size?: keyof typeof SIZE
  className?: string
}) {
  const initials = (name ?? '').trim().slice(0, 2).toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)] font-semibold text-[var(--c-text-2)]',
        SIZE[size],
        className,
      )}
      aria-hidden={!name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials || '·'}
    </span>
  )
}

export { Avatar }
