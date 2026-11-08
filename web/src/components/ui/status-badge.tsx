import { useTranslation } from 'react-i18next'
import { Badge } from './badge'
import { cn } from '../../lib/utils'

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_TO_VARIANT: Record<StatusTone, 'success' | 'warning' | 'danger' | 'secondary' | 'info'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'secondary',
  info: 'info',
}

// The dot form is a bare 8px swatch rather than a badge with a label, so it
// carries its own, lighter touch: at that size the solid token reads as a heavy
// blob (the agent list looked like a solid green light).
const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-success/60',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
}

const STATUS_TONE: Record<string, StatusTone> = {
  up: 'success',
  healthy: 'success',
  active: 'success',
  running: 'success',
  connected: 'success',
  online: 'success',
  enabled: 'success',
  ok: 'success',
  open: 'success',
  degraded: 'warning',
  partial: 'warning',
  pending: 'warning',
  provisioning: 'warning',
  creating: 'warning',
  paused: 'warning',
  'rate-limit': 'warning',
  down: 'danger',
  unhealthy: 'danger',
  failed: 'danger',
  error: 'danger',
  inactive: 'neutral',
  disabled: 'neutral',
  stopped: 'neutral',
  unknown: 'neutral',
  created: 'info',
}

function toneForStatus(status: string): StatusTone {
  const lower = status.toLowerCase()
  return STATUS_TONE[lower] ?? 'neutral'
}

function StatusBadge({
  status,
  tone,
  className,
  dotOnly,
}: {
  status: string
  tone?: StatusTone
  className?: string
  dotOnly?: boolean
}) {
  const { t } = useTranslation()
  const resolved = tone ?? toneForStatus(status)
  const label = t(`enums.status.${status.toLowerCase()}`, { defaultValue: status })
  if (dotOnly) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT[resolved], className)}
      />
    )
  }
  return (
    <Badge variant={TONE_TO_VARIANT[resolved]} className={className}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current`} />
      {label}
    </Badge>
  )
}

export { StatusBadge, toneForStatus }
