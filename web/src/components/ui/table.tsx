import * as React from 'react'
import { cn } from '../../lib/utils'

// A table opts into the stacked presentation with `stacked`, and each of its
// cells names itself with `label`. Below `md` every row becomes a column of
// label/value pairs — the table a phone can actually read — while `md` and up
// keeps the table unchanged. Hiding columns on a narrow screen would be the
// cheaper trick, but these tables are read for their details.
//
// The flag travels down through context so a page only marks its table and its
// cells, and a table that never asks for it is untouched.
const TableStackContext = React.createContext(false)

function Table({
  className,
  scrollable = true,
  stacked = false,
  ...props
}: React.ComponentProps<'table'> & { scrollable?: boolean; stacked?: boolean }) {
  const content = (
    <table
      className={cn('w-full caption-bottom text-sm', stacked && 'block md:table', className)}
      {...props}
    />
  )
  return (
    <TableStackContext.Provider value={stacked}>
      {scrollable ? <div className="relative w-full overflow-auto">{content}</div> : content}
    </TableStackContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  const stacked = React.useContext(TableStackContext)
  return (
    <thead
      className={cn(
        'bg-[var(--c-surface-2)] [&_tr]:border-b [&_tr]:border-[var(--c-border)]',
        stacked && 'hidden md:table-header-group',
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  const stacked = React.useContext(TableStackContext)
  return (
    <tbody
      className={cn('[&_tr:last-child]:border-0', stacked && 'block md:table-row-group', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  const stacked = React.useContext(TableStackContext)
  return (
    <tr
      className={cn(
        'ui-row transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        // The cells carry the column widths and alignments the desktop table
        // wants; inside the stacked card both have to go, and doing it here
        // keeps every cell from repeating `w-full md:w-24`-style pairs.
        stacked && 'flex flex-col max-md:[&>td]:w-full max-md:[&>td]:text-left md:table-row',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'ui-label text-left align-middle',
        className,
      )}
      {...props}
    />
  )
}

// TableCell's `label` is what the cell is called in the stacked layout: the
// header row is hidden there, so without it a stacked row would show a value
// with nothing saying what it is.
function TableCell({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<'td'> & { label?: React.ReactNode }) {
  const stacked = React.useContext(TableStackContext)
  if (!stacked || label === undefined) {
    return (
      <td className={cn('ui-cell align-middle', className)} {...props}>
        {children}
      </td>
    )
  }
  return (
    <td className={cn('ui-cell flex flex-col gap-1 align-middle md:table-cell', className)} {...props}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:hidden">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </td>
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
