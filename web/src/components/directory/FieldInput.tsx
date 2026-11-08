import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import type { FieldError } from '../../lib/directoryApi'
import type { DirectoryDraft, DirectoryField } from '../../lib/directoryFields'
import { boolString, isTrue } from '../../lib/directoryFields'

export type FieldInputProps = {
  field: DirectoryField
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  error?: FieldError
  disabled?: boolean
}

// FieldErrorText renders a rejected value. Codes come from the auth service, so
// the wording stays here where it can be translated.
export function FieldErrorText({ error }: { error?: FieldError }) {
  const { t } = useTranslation()
  if (!error) {
    return null
  }
  const key = `directory.error.${error.code}`
  const translated = t(key)
  return <p className="text-xs text-destructive">{translated === key ? error.message : translated}</p>
}

// FieldInput renders one setting: a switch for booleans, a select for enums, a
// text area for PEM blocks, a password box for the bind secret, and a plain
// input otherwise.
export function FieldInput({ field, draft, setValue, error, disabled }: FieldInputProps) {
  const { t } = useTranslation()
  const value = draft[field.key] ?? ''
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="text-sm font-medium" htmlFor={field.key}>
            {t(field.labelKey)}
          </label>
          <p className="text-xs text-muted-foreground">{t(field.helpKey)}</p>
        </div>
        {field.kind === 'bool' ? (
          <Switch
            id={field.key}
            checked={isTrue(value)}
            disabled={disabled}
            onCheckedChange={(checked) => setValue(field.key, boolString(checked))}
          />
        ) : null}
      </div>

      {field.kind === 'bool' ? null : field.kind === 'select' ? (
        <Select
          value={value || 'auto'}
          disabled={disabled}
          onValueChange={(next) => setValue(field.key, next)}
        >
          <SelectTrigger
            className={error ? 'border-destructive' : undefined}
            aria-label={t(field.labelKey)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === 'textarea' ? (
        <Textarea
          id={field.key}
          value={value}
          disabled={disabled}
          rows={3}
          spellCheck={false}
          className={`font-mono text-xs ${error ? 'border-destructive' : ''}`}
          placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={field.key}
            value={value}
            disabled={disabled}
            spellCheck={false}
            type={
              field.kind === 'password' && !revealed ? 'password' : field.kind === 'int' ? 'number' : 'text'
            }
            className={`font-mono text-xs ${error ? 'border-destructive' : ''}`}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
          {field.kind === 'password' ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              aria-label={t(revealed ? 'directory.hideSecret' : 'directory.showSecret')}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
      )}

      <FieldErrorText error={error} />
    </div>
  )
}
