import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { ModelsPanel } from '../components/models/ModelsPanel'

// Admin Model Configuration module: the standalone, first-class surface for the
// platform model provider/model catalog (extracted from the generic Config
// Center). Provider/model values remain readable by the runtime as a fallback.
//
// Dictation has its own console (/admin/voice): its three tiers are settings of
// their own, and the only thing they share with this page is where the providers
// come from.
export function ModelsPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('nav.models')}</h1>
        <p className="text-sm text-muted-foreground">{t('models.adminHint')}</p>
      </div>
      <Link
        to="/admin/voice"
        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
      >
        <Mic className="size-4" />
        {t('nav.voiceInput')}
      </Link>
      <ModelsPanel mode="admin" />
    </div>
  )
}
