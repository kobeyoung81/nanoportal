import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import type { DirectoryDraft } from '../../lib/directoryFields'

export type RawCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  unknownKeys: string[]
  disabled?: boolean
}

// RawCard is the escape hatch: every ldap.* key as the store holds it, including
// any the page does not model yet. It exists because the config center and this
// page edit the same rows, and a setting must never become unreachable.
export function RawCard({ draft, setValue, unknownKeys, disabled }: RawCardProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const keys = Object.keys(draft)
    .filter((key) => key.startsWith('ldap.'))
    .sort()

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('directory.rawTitle')}</CardTitle>
          <CardDescription>{t('directory.rawDescription')}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setOpen((current) => !current)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {open ? t('directory.hideRaw') : t('directory.showRaw')}
        </Button>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-2">
          {unknownKeys.length > 0 ? (
            <p className="text-xs text-warning">
              {t('directory.unknownKeys', { keys: unknownKeys.join(', ') })}
            </p>
          ) : null}
          {keys.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-56 shrink-0 truncate font-mono text-xs text-muted-foreground">{key}</span>
              <Input
                value={draft[key] ?? ''}
                spellCheck={false}
                disabled={disabled}
                className="h-8 font-mono text-xs"
                onChange={(event) => setValue(key, event.target.value)}
              />
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}
