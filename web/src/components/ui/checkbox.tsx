import * as React from 'react'
import { cn } from '../../lib/utils'

// 原生 checkbox 只做外观替换：键盘、表单提交、indeterminate 都交给浏览器。
// 外观在 primitives.css 的 .ui-checkbox 里（对勾是 data URI，Chrome 109 也认）。
function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return <input type="checkbox" className={cn('ui-checkbox', className)} {...props} />
}

export { Checkbox }
