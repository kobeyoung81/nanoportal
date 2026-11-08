import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import type { BrowseNode, FieldError } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { fieldsOfSection } from '../../lib/directoryFields'
import { FieldInput } from './FieldInput'

export type GroupCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  errors: Record<string, FieldError>
  groupFilter: string
  onGroupFilterChange: (filter: string) => void
  groups: BrowseNode[] | null
  searching: boolean
  onSearch: () => void
  disabled?: boolean
}

// GroupCard restricts sign-ins to one directory group. The picker shows the
// group's human label and member count, because a DN alone says very little.
export function GroupCard({
  draft,
  setValue,
  errors,
  groupFilter,
  onGroupFilterChange,
  groups,
  searching,
  onSearch,
  disabled,
}: GroupCardProps) {
  const { t } = useTranslation()
  const [showPicker, setShowPicker] = useState(false)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('directory.sectionGroup')}</CardTitle>
          <CardDescription>{t('directory.groupDescription')}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setShowPicker(true)
            onSearch()
          }}
          disabled={disabled}
        >
          <Search className="h-4 w-4" />
          {t('directory.findGroups')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {fieldsOfSection('group').map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            draft={draft}
            setValue={setValue}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}

        {showPicker ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Input
                value={groupFilter}
                spellCheck={false}
                className="h-8 font-mono text-xs"
                aria-label={t('directory.groupFilter')}
                onChange={(event) => onGroupFilterChange(event.target.value)}
              />
              <Button size="sm" variant="outline" className="shrink-0" onClick={onSearch} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {t('directory.search')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('directory.groupFilterHint')}</p>

            {groups ? (
              groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('directory.noGroups')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {groups.map((group) => (
                    <li
                      key={group.dn}
                      className="flex items-center justify-between gap-3 rounded-md border bg-card p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{group.label}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{group.dn}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {t('directory.memberCount', { count: group.members ?? 0 })}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setValue('ldap.requiredGroupDN', group.dn)}
                          disabled={disabled}
                        >
                          {t('directory.useGroup')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
