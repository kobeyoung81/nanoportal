import { useCallback, useState } from 'react'

/**
 * Wraps an async action with a busy flag. Use for mutations; keep toasts at
 * the call site via sonner.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      return await action()
    } finally {
      setBusy(false)
    }
  }, [])

  return { run, busy }
}
