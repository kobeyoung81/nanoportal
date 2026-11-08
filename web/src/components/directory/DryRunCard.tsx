import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldQuestion } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import type { CheckResponse } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { outcomeKey, outcomeTone, uniqueIDSourceKey } from '../../lib/directoryLogic'

export type DryRunCardProps = {
  draft: DirectoryDraft
  onCheck: (email: string, password: string) => void
  checking: boolean
  result: CheckResponse | null
  disabled?: boolean
}

// DryRunCard walks the whole login chain for one mailbox and changes nothing:
// no account is created, no identity is linked, no password is touched. It is
// the fastest answer to "why can't this person sign in".
export function DryRunCard({ onCheck, checking, result, disabled }: DryRunCardProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('directory.dryRunTitle')}</CardTitle>
        <CardDescription>{t('directory.dryRunDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={email}
            placeholder={t('directory.dryRunEmail')}
            spellCheck={false}
            className="text-xs"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            value={password}
            type="password"
            placeholder={t('directory.dryRunPassword')}
            className="text-xs"
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button
            className="shrink-0"
            onClick={() => onCheck(email.trim(), password)}
            disabled={disabled || checking || email.trim() === ''}
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldQuestion className="h-4 w-4" />}
            {t('directory.dryRunSubmit')}
          </Button>
        </div>

        {result ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={outcomeTone(result.outcome)}>{t(outcomeKey(result.outcome))}</Badge>
              {result.existing_account ? (
                <span className="text-xs text-muted-foreground">
                  {t('directory.existingAccount', {
                    name: result.existing_account.display_name || result.existing_account.user_id,
                    role: result.existing_account.role,
                    status: result.existing_account.status,
                  })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t('directory.noExistingAccount')}</span>
              )}
            </div>

            <dl className="flex flex-col gap-1 text-xs">
              <Row label={t('directory.checkFilter')} value={result.filter} mono />
              <Row label={t('directory.checkMatches')} value={String(result.check.match_count)} />
              {result.check.dn ? <Row label={t('directory.checkDN')} value={result.check.dn} mono /> : null}
              {result.check.unique_id ? (
                <Row
                  label={t('directory.checkUniqueId')}
                  value={`${result.check.unique_id} · ${t(uniqueIDSourceKey(result.check.unique_id_source))}`}
                  mono
                />
              ) : null}
              {result.check.username ? (
                <Row label={t('directory.checkUsername')} value={result.check.username} mono />
              ) : null}
              {result.check.display_name ? (
                <Row label={t('directory.checkDisplayName')} value={result.check.display_name} />
              ) : null}
              {result.check.group_required ? (
                <Row
                  label={t('directory.checkGroup')}
                  value={
                    result.check.group_ok
                      ? t('directory.groupMatched')
                      : t('directory.groupNotMatched')
                  }
                />
              ) : null}
              <Row
                label={t('directory.checkBind')}
                value={
                  !result.check.bind_attempted
                    ? t('directory.bindNotAttempted')
                    : result.check.bound
                      ? t('directory.bindOk')
                      : `${t('directory.bindFailed')}: ${result.check.bind_error ?? ''}`
                }
              />
            </dl>

            {result.check.attributes && Object.keys(result.check.attributes).length > 0 ? (
              <div className="flex flex-col gap-1 text-xs">
                <p className="font-medium">{t('directory.checkAttributes')}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {Object.entries(result.check.attributes).map(([key, value]) => (
                    <p key={key} className="truncate font-mono text-[11px] text-muted-foreground">
                      {key}: {value}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 flex-1 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  )
}
