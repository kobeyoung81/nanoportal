import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

// 右侧抽屉：复用 dialog 的无障碍语义（焦点陷阱、Esc、aria-modal），
// 只是把内容贴在右边并占满高度。
const Drawer = DialogPrimitive.Root
const DrawerTrigger = DialogPrimitive.Trigger
const DrawerClose = DialogPrimitive.Close

function DrawerContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string
  description?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--c-scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col border-l border-[var(--c-border)] bg-[var(--c-surface)] shadow-[var(--ui-shadow-2)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-[var(--c-text-2)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rounded-[var(--ui-radius-sm)] p-1 text-[var(--c-text-2)] transition-colors hover:bg-[var(--c-hover-surface)] hover:text-[var(--c-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-auto flex items-center justify-end gap-2 border-t border-[var(--c-border)] px-5 py-3', className)}
      {...props}
    />
  )
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerFooter }
