import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleDashed, Loader2, PlugZap, WandSparkles, XCircle } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import type { FieldError, ProbeResult } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { fieldsOfSection } from '../../lib/directoryFields'
import { FieldInput } from './FieldInput'

export type ConnectionCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  errors: Record<string, FieldError>
  probe: ProbeResult | null
  testing: boolean
  onTest: () => void
  onApplyPreset: () => void
  disabled?: boolean
}

// ConnectionCard is the first step of the page: where the directory is, which
// account reads it, and the five-step probe that says whether any of it works.
export function ConnectionCard({
  draft,
  setValue,
  errors,
  probe,
  testing,
  onTest,
  onApplyPreset,
  disabled,
}: ConnectionCardProps) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('directory.sectionConnection')}</CardTitle>
          <CardDescription>{t('directory.connectionDescription')}</CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          {probe && probe.preset.kind !== 'unknown' && probe.ok ? (
            <Button variant="outline" size="sm" onClick={onApplyPreset} disabled={disabled}>
              <WandSparkles className="h-4 w-4" />
              {t('directory.applyPreset')}
            </Button>
          ) : null}
          <Button size="sm" onClick={onTest} disabled={disabled || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            {t('directory.testConnection')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {fieldsOfSection('connection').map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            draft={draft}
            setValue={setValue}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}

        {probe ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Badge variant={probe.ok ? 'success' : 'danger'}>
                {probe.ok ? t('directory.probeOk') : t('directory.probeFailed')}
              </Badge>
              <Badge variant="outline">
                {t(`directory.directoryKind.${probe.kind}`, { defaultValue: probe.kind })}
              </Badge>
              {probe.anonymous ? (
                <Badge variant="secondary">{t('directory.anonymousSearch')}</Badge>
              ) : null}
            </div>
            <ol className="flex flex-col gap-1.5">
              {probe.steps.map((step) => (
                <li key={step.name} className="flex items-start gap-2 text-xs">
                  {step.status === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : step.status === 'skipped' ? (
                    <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="w-24 shrink-0 font-medium">
                    {t(`directory.step.${step.name}`, { defaultValue: step.name })}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-muted-foreground">{step.detail}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{step.duration_ms} ms</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
