import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { changeLang, type Lang } from '../i18n'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const current: Lang = i18n.language.startsWith('zh') ? 'zh-CN' : 'en'
  const next: Lang = current === 'en' ? 'zh-CN' : 'en'
  const nextLabel = next === 'zh-CN' ? '中文' : 'EN'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={() => changeLang(next)} aria-label={t('nav.toggleLanguage')}>
          <Languages className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{nextLabel}</TooltipContent>
    </Tooltip>
  )
}
