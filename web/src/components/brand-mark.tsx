import { cn } from '../lib/utils'

// The mark: a single closed path (1000 x 880), filled with the current text
// colour so it reads dark on light headers and white on the dark rail.
const LETTER =
  'M0,0 L580,0 A420,420 0 0 1 1000,420 L1000,840 A40,40 0 0 1 960,880 L640,880 ' +
  'L640,420 A170,170 0 0 0 300,420 L300,880 L40,880 A40,40 0 0 1 0,840 Z'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 880"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <path d={LETTER} />
    </svg>
  )
}
