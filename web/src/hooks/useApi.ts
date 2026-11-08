import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import { ADMIN_API_BASE } from '../lib/api'

type AsyncState<T> = {
  data: T | null
  error: string | null
  resolvedPath: string | null
}

export function useApi<T>(path: string | null, base = ADMIN_API_BASE) {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    resolvedPath: null,
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!path) {
      return
    }

    let ignore = false

    fetchJson<T>(path, base)
      .then((data) => {
        if (ignore) {
          return
        }
        setState({ data, error: null, resolvedPath: path })
      })
      .catch((error: Error) => {
        if (ignore) {
          return
        }
        setState({ data: null, error: error.message, resolvedPath: path })
      })

    return () => {
      ignore = true
    }
  }, [path, refreshKey, base])

  const refetch = useCallback(() => {
    setRefreshKey((key) => key + 1)
  }, [])

  const mutate = useCallback(
    (data: T | null) => {
      setState({ data, error: null, resolvedPath: path })
    },
    [path],
  )

  return {
    data: state.data,
    error: state.resolvedPath === path ? state.error : null,
    loading: Boolean(path) && state.resolvedPath !== path,
    refetch,
    mutate,
  }
}
