import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import type { FieldError } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { fieldsOfSection } from '../../lib/directoryFields'
import { FieldInput } from './FieldInput'

export type PolicyCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  errors: Record<string, FieldError>
  disabled?: boolean
}

// PolicyCard is about the relationship between a directory identity and a
// platform account: who gets created, when two accounts become one, what
// happens when someone leaves.
export function PolicyCard({ draft, setValue, errors, disabled }: PolicyCardProps) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('directory.sectionPolicy')}</CardTitle>
        <CardDescription>{t('directory.policyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {fieldsOfSection('policy').map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            draft={draft}
            setValue={setValue}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          {t('directory.privilegedNote')}
        </p>
      </CardContent>
    </Card>
  )
}
