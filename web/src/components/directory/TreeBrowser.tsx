import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Loader2, Users2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import type { BrowseNode, BrowseResult } from '../../lib/directoryApi'

export type TreeBrowserProps = {
  roots: BrowseNode[]
  selectedDN?: string
  onSelect: (dn: string) => void
  onBrowse: (dn: string) => Promise<BrowseResult>
  disabled?: boolean
}

// TreeBrowser walks the directory one level at a time: nothing is read until a
// node is opened, so a large directory costs one search per level the operator
// actually looks at.
export function TreeBrowser({ roots, selectedDN, onSelect, onBrowse, disabled }: TreeBrowserProps) {
  const { t } = useTranslation()
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border bg-card/50 p-1">
      {roots.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{t('directory.treeEmpty')}</p>
      ) : null}
      <ul className="flex flex-col">
        {roots.map((node) => (
          <TreeRow
            key={node.dn}
            node={node}
            depth={0}
            selectedDN={selectedDN}
            onSelect={onSelect}
            onBrowse={onBrowse}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  )
}

type TreeRowProps = {
  node: BrowseNode
  depth: number
  selectedDN?: string
  onSelect: (dn: string) => void
  onBrowse: (dn: string) => Promise<BrowseResult>
  disabled?: boolean
}

function TreeRow({ node, depth, selectedDN, onSelect, onBrowse, disabled }: TreeRowProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<BrowseNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    if (disabled) {
      return
    }
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (children !== null) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await onBrowse(node.dn)
      setChildren(result.nodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('directory.treeReadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const expandable = node.has_children
  const selected = node.dn === selectedDN

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded px-1.5 py-1 text-sm',
          selected ? 'rail-active bg-primary-weak text-foreground' : 'hover:bg-accent',
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background disabled:opacity-30"
          onClick={toggle}
          disabled={disabled || !expandable}
          aria-label={t(open ? 'directory.collapseNode' : 'directory.expandNode')}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : expandable ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          )}
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          onClick={() => onSelect(node.dn)}
          disabled={disabled}
        >
          <span className="truncate font-medium">{node.label}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">{node.dn}</span>
        </button>

        {typeof node.members === 'number' && node.members > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Users2 className="h-3 w-3" />
            {node.members}
          </span>
        ) : null}
        {typeof node.subordinates === 'number' && node.subordinates > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{node.subordinates}</span>
        ) : null}
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t(`directory.kind.${node.kind}`, { defaultValue: node.kind })}
        </Badge>
      </div>

      {error ? <p className="px-2 py-1 text-xs text-destructive">{error}</p> : null}

      {open && children && children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <TreeRow
              key={child.dn}
              node={child}
              depth={depth + 1}
              selectedDN={selectedDN}
              onSelect={onSelect}
              onBrowse={onBrowse}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : null}
      {open && children && children.length === 0 ? (
        <p className="text-xs text-muted-foreground" style={{ paddingLeft: `${depth * 14 + 26}px` }}>
          {t('directory.noChildren')}
        </p>
      ) : null}
    </li>
  )
}
