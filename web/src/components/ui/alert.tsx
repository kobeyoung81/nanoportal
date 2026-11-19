import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONE: Record<AlertTone, { icon: typeof Info; cls: string; iconCls: string }> = {
  info: { icon: Info, cls: 'border-[var(--c-info-weak)] bg-[var(--c-info-weak)]', iconCls: 'text-[var(--c-info)]' },
  success: { icon: CheckCircle2, cls: 'border-[var(--c-success-weak)] bg-[var(--c-success-weak)]', iconCls: 'text-[var(--c-success)]' },
  warning: { icon: AlertTriangle, cls: 'border-[var(--c-warning-weak)] bg-[var(--c-warning-weak)]', iconCls: 'text-[var(--c-warning)]' },
  danger: { icon: XCircle, cls: 'border-[var(--c-danger-weak)] bg-[var(--c-danger-weak)]', iconCls: 'text-[var(--c-danger)]' },
}

// 内联提示：比 toast 更持久，比对话框更轻。
function Alert({
  tone = 'info',
  title,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & { tone?: AlertTone; title?: React.ReactNode }) {
  const { icon: Icon, cls, iconCls } = TONE[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-[var(--ui-radius-md)] border px-3 py-2.5 text-sm',
        cls,
        className,
      )}
      {...props}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconCls)} aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn('text-[var(--c-text-2)]', title && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  )
}

export { Alert }
