import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Switch } from '../ui/switch'
import { FieldErrorText } from './FieldInput'
import type { EffectiveResponse, FieldError, ProbeResult } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { boolString, isTrue } from '../../lib/directoryFields'
import { diffEffective } from '../../lib/directoryLogic'

export type StatusCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  errors: Record<string, FieldError>
  effective: EffectiveResponse | null
  probe: ProbeResult | null
  probeAt: string | null
  disabled?: boolean
}

// StatusCard answers the two questions an operator actually has: is directory
// login on, and has the value I just saved reached the auth service yet.
export function StatusCard({
  draft,
  setValue,
  errors,
  effective,
  probe,
  probeAt,
  disabled,
}: StatusCardProps) {
  const { t } = useTranslation()
  const differences = effective?.settings ? diffEffective(draft, effective.settings) : []
  const compares = effective?.settings ? differences.length === 0 : true

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('directory.sectionStatus')}</CardTitle>
          <CardDescription>{t('directory.statusDescription')}</CardDescription>
        </div>
        <Switch
          checked={isTrue(draft['ldap.enabled'])}
          disabled={disabled}
          onCheckedChange={(checked) => setValue('ldap.enabled', boolString(checked))}
          aria-label={t('directory.field.enabled')}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-xs">
        <FieldErrorText error={errors['ldap.enabled']} />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isTrue(draft['ldap.enabled']) ? 'success' : 'secondary'}>
            {isTrue(draft['ldap.enabled']) ? t('directory.enabled') : t('directory.disabled')}
          </Badge>
          {effective?.configured === false ? (
            <Badge variant="warning">{t('directory.notConfigured')}</Badge>
          ) : null}
          {effective?.loaded_at ? (
            <span className="text-muted-foreground">
              {t('directory.loadedAt', { time: new Date(effective.loaded_at).toLocaleTimeString() })}
            </span>
          ) : null}
        </div>

        <div className="rounded-md border border-dashed p-2">
          {compares ? (
            <p className="text-muted-foreground">{t('directory.effectiveInSync')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t('directory.effectiveOutOfSync')}</p>
              {differences.map((diff) => (
                <p key={diff.key} className="font-mono text-[11px] text-muted-foreground">
                  {diff.key}: {t('directory.savedValue')} <span className="text-foreground">{diff.saved || '∅'}</span>{' '}
                  → {t('directory.effectiveValue')}{' '}
                  <span className="text-foreground">{diff.effective || '∅'}</span>
                </p>
              ))}
              <p className="text-muted-foreground">{t('directory.effectiveHint')}</p>
            </div>
          )}
        </div>

        {probeAt ? (
          <p className="text-muted-foreground">
            {t('directory.lastProbe', { time: new Date(probeAt).toLocaleString() })}:{' '}
            {probe?.ok ? t('directory.probeOk') : t('directory.probeFailed')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
