// The pieces the voice console is built from: one card per tier, and the field
// wrappers that make every row line up the same way.
//
// A tier is explained before it is configured — the three layers differ in what
// they cost and when they run, and that is the part an operator has to decide.

import type { ReactNode } from 'react'
import { Card } from '../ui/card'
import { Switch } from '../ui/switch'

export function VoiceCard({
  title,
  hint,
  children,
  actions,
}: {
  title: string
  hint?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <Card className="p-4" data-voice-card="">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{children}</div>
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </Card>
  )
}

export function VoiceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** VoiceSwitch is a labelled switch row that spans both columns. */
export function VoiceSwitch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 md:col-span-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
