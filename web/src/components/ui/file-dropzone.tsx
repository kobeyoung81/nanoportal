import * as React from 'react'
import { Upload } from 'lucide-react'
import { cn } from '../../lib/utils'

// 拖放 + 点击选择。只负责"拿到文件"，校验交给调用方（尺寸/类型各页面不同）。
function FileDropzone({
  onFiles,
  accept,
  multiple = false,
  hint,
  className,
}: {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  hint?: React.ReactNode
  className?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [over, setOver] = React.useState(false)

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles([...list])
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        take(event.dataTransfer.files)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--ui-radius-lg)] border border-dashed px-4 py-6 text-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        over
          ? 'border-[var(--c-accent)] bg-[var(--c-accent-weak)]'
          : 'border-[var(--c-border-strong)] bg-[var(--c-surface-2)] hover:border-[var(--c-accent)]',
        className,
      )}
    >
      <Upload className="h-4 w-4 text-[var(--c-text-3)]" aria-hidden="true" />
      <p className="text-xs text-[var(--c-text-2)]">{hint ?? '把文件拖到这里，或点击选择'}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          take(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export { FileDropzone }
