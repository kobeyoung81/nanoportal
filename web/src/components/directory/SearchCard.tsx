import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, Radar, Search } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { AnalyzeResult, BrowseNode, BrowseResult, FieldError, Recommendation } from '../../lib/directoryApi'
import type { DirectoryDraft } from '../../lib/directoryFields'
import { fieldsOfSection } from '../../lib/directoryFields'
import { attributeHelpKey, presencePercent, recommendationReasonKey } from '../../lib/directoryLogic'
import { FieldInput } from './FieldInput'
import { TreeBrowser } from './TreeBrowser'

export type SearchCardProps = {
  draft: DirectoryDraft
  setValue: (key: string, value: string) => void
  errors: Record<string, FieldError>
  roots: BrowseNode[]
  treeLoading: boolean
  onBrowseRoot: () => void
  onBrowse: (dn: string) => Promise<BrowseResult>
  analyze: AnalyzeResult | null
  analyzing: boolean
  onAnalyze: () => void
  onApplyRecommendation: (rec: Recommendation) => void
  onApplyAll: () => void
  disabled?: boolean
}

// SearchCard is where the guessing stops: pick the search base off the tree,
// sample it, and let the analysis say which attribute can carry an identity.
export function SearchCard({
  draft,
  setValue,
  errors,
  roots,
  treeLoading,
  onBrowseRoot,
  onBrowse,
  analyze,
  analyzing,
  onAnalyze,
  onApplyRecommendation,
  onApplyAll,
  disabled,
}: SearchCardProps) {
  const { t } = useTranslation()
  const suggestions = (analyze?.recommendations ?? []).filter((rec) => rec.level === 'suggestion')
  const warnings = (analyze?.recommendations ?? []).filter((rec) => rec.level === 'warning')

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('directory.sectionSearch')}</CardTitle>
          <CardDescription>{t('directory.searchDescription')}</CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onBrowseRoot} disabled={disabled || treeLoading}>
            {treeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('directory.loadTree')}
          </Button>
          <Button size="sm" onClick={onAnalyze} disabled={disabled || analyzing}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            {t('directory.analyze')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {fieldsOfSection('search').map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            draft={draft}
            setValue={setValue}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('directory.treeHint')}</p>
          <TreeBrowser
            roots={roots}
            selectedDN={draft['ldap.baseDN'] ?? ''}
            onSelect={(dn) => setValue('ldap.baseDN', dn)}
            onBrowse={onBrowse}
            disabled={disabled}
          />
        </div>

        {analyze ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {t(`directory.directoryKind.${analyze.kind}`, { defaultValue: analyze.kind })}
              </Badge>
              <span>{t('directory.samples', { count: analyze.samples })}</span>
              {analyze.truncated ? <Badge variant="warning">{t('directory.sampleTruncated')}</Badge> : null}
            </div>

            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('directory.attributeColumn')}</TableHead>
                  <TableHead className="w-24 text-right">{t('directory.presence')}</TableHead>
                  <TableHead className="w-24 text-right">{t('directory.distinct')}</TableHead>
                  <TableHead className="w-24 text-right">{t('directory.duplicates')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analyze.attributes.map((stat) => {
                  const help = attributeHelpKey(stat.attribute)
                  const duplicated = stat.duplicates > 0
                  return (
                    <TableRow key={stat.attribute}>
                      <TableCell label={t('directory.attributeColumn')}>
                        <span className="font-mono text-xs">{stat.attribute}</span>
                        {help ? (
                          <span className="block text-[11px] text-muted-foreground">{t(help)}</span>
                        ) : null}
                        {duplicated && stat.examples?.length ? (
                          <span className="block font-mono text-[11px] text-destructive">
                            {stat.examples.join(', ')}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell label={t('directory.presence')} className="text-right tabular-nums">
                        {presencePercent(stat)}%
                      </TableCell>
                      <TableCell label={t('directory.distinct')} className="text-right tabular-nums">
                        {stat.distinct}
                      </TableCell>
                      <TableCell
                        label={t('directory.duplicates')}
                        className={`text-right tabular-nums ${duplicated ? 'text-destructive' : ''}`}
                      >
                        {stat.duplicates}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">{t('directory.suggestions')}</h4>
                  <Button variant="outline" size="sm" onClick={onApplyAll} disabled={disabled}>
                    {t('directory.applyAll')}
                  </Button>
                </div>
                {suggestions.map((rec) => (
                  <div
                    key={rec.key + rec.value}
                    className="flex items-start justify-between gap-3 rounded-md border bg-card p-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs">{rec.key}</p>
                      <p className="break-all font-mono text-xs text-muted-foreground">{rec.value}</p>
                      <p className="text-[11px] text-muted-foreground">{t(recommendationReasonKey(rec.reason))}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => onApplyRecommendation(rec)}
                      disabled={disabled}
                    >
                      {t('directory.apply')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <div className="flex flex-col gap-1">
                {warnings.map((rec) => (
                  <p key={rec.key + rec.reason} className="flex items-start gap-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-mono">{rec.key}</span>:{' '}
                      {t(recommendationReasonKey(rec.reason))}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {fieldsOfSection('matching').map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            draft={draft}
            setValue={setValue}
            error={errors[field.key]}
            disabled={disabled}
          />
        ))}
      </CardContent>
    </Card>
  )
}
