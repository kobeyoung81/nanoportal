import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ComboboxOption = { value: string; label: string; hint?: string }

// 输入 + 过滤 + 键盘。没有引入新依赖：列表就是一个带 role="listbox" 的 div，
// 焦点留在输入框上，用 aria-activedescendant 指向当前项。
function Combobox({
  options,
  value,
  onChange,
  placeholder = '搜索…',
  emptyText = '没有匹配项',
  className,
  id,
}: {
  options: ComboboxOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  className?: string
  id?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const selected = options.find((option) => option.value === value)
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => option.label.toLowerCase().includes(needle))
  }, [options, query])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const commit = (option: ComboboxOption | undefined) => {
    if (!option) return
    onChange(option.value)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="ui-field items-center gap-1.5 px-2">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          className="h-full w-full min-w-0 bg-transparent text-[var(--c-text)] outline-none placeholder:text-[var(--c-text-3)]"
          value={open ? query : selected?.label ?? ''}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive((index) => Math.min(index + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              commit(filtered[active])
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--c-text-3)]" aria-hidden="true" />
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto rounded-[var(--ui-radius-md)] border border-[var(--c-border)] bg-[var(--c-surface-3)] p-1 shadow-[var(--ui-shadow-2)]"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-[var(--c-text-3)]">{emptyText}</p>
          ) : (
            filtered.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[var(--ui-radius-sm)] px-2 py-1.5 text-xs',
                  index === active ? 'bg-[var(--c-accent-weak)] text-[var(--c-text)]' : 'text-[var(--c-text-2)]',
                )}
              >
                <Check
                  className={cn('h-3 w-3 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? <span className="text-[var(--c-text-3)]">{option.hint}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export { Combobox }
