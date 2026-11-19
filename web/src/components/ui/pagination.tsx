import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {t('pagination.showing', { from, to, total })}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-[var(--ui-control-h-sm)] rounded-[var(--ui-radius-md)] border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t('pagination.pageSize')}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {t('pagination.perPage', { size })}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                aria-label={t('pagination.previous')}
              >
                <ChevronLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('pagination.previous')}</TooltipContent>
          </Tooltip>
          <span className="min-w-16 px-2 text-center text-sm text-muted-foreground">
            {page} / {pages}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= pages}
                onClick={() => onPageChange(page + 1)}
                aria-label={t('pagination.next')}
              >
                <ChevronRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('pagination.next')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export { Pagination }
