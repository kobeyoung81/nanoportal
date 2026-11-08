import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Code, Download, Eye, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { FilePreviewBody } from '../components/agent/FilePreviewBody'
import { PreviewReloadButton } from '../components/agent/PreviewReloadButton'
import { Button } from '../components/ui/button'
import { useFileContent } from '../hooks/useFileContent'
import { classifyFileType } from '../lib/fileTypes'
import { downloadToDisk } from '../lib/fileDownload'
import { previewTarget, showsSourceToggle, type ViewerMode } from '../lib/fileViewer'

// FileViewerPage is the standalone preview: the same body as the dialog, in a
// real browser tab. It reads its file from the query string so the address can
// be refreshed, bookmarked or sent to another signed-in tab.
export function FileViewerPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const agentId = params.get('agent') ?? ''
  const path = params.get('path') ?? ''
  const [mode, setMode] = useState<ViewerMode>(params.get('mode') === 'source' ? 'source' : 'preview')
  const [reloadKey, setReloadKey] = useState(0)

  const name = path.split('/').pop() ?? ''
  const fileType = classifyFileType(name)
  const target = previewTarget(fileType, mode)
  const content = useFileContent(agentId, path, fileType, reloadKey)

  useEffect(() => {
    document.title = name || t('files.title')
  }, [name, t])

  const handleDownload = async () => {
    try {
      await downloadToDisk(agentId, path, name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.downloadFailed'))
    }
  }

  if (!agentId || !path) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('files.viewerMissing')}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/files">
            <ArrowLeft className="h-4 w-4" />
            {t('files.title')}
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" aria-label={t('files.title')}>
          <Link to={`/files?agent=${encodeURIComponent(agentId)}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate font-mono text-sm font-medium" title={path}>
          {name}
        </h1>
        {showsSourceToggle(fileType, true) ? (
          mode === 'preview' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('source')}>
              <Code className="h-3.5 w-3.5" />
              {t('files.source')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setMode('preview')}>
              <Eye className="h-3.5 w-3.5" />
              {t('files.preview')}
            </Button>
          )
        ) : null}
        <PreviewReloadButton loading={content.status === 'loading'} onClick={() => setReloadKey((key) => key + 1)} />
        <Button variant="ghost" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          {t('files.download')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <FilePreviewBody
          name={name}
          kind={fileType}
          target={target}
          content={content}
          reloadKey={reloadKey}
          onDownload={handleDownload}
        />
      </div>
    </div>
  )
}
