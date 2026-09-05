// Shared data-fetching + error-state helpers for every Admin page. Extracted
// from the original monolithic AdminPage.tsx (Admin frontend redesign,
// Phase 1) — every section below depended on this exact same logic, so it
// now lives in one place instead of being duplicated per-route.
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'

export function panelMessage(e: unknown): { kind: 'unauthorized' | 'forbidden' | 'error'; message: string } {
  if (e instanceof ApiError) {
    if (e.status === 401) return { kind: 'unauthorized', message: 'Your session has expired. Please sign in again.' }
    if (e.status === 403) return { kind: 'forbidden', message: 'Your admin account does not have permission to view this. The backend rejected this request — hiding this page would not have been real security, so it is shown with an honest Forbidden state instead.' }
    return { kind: 'error', message: e.message }
  }
  return { kind: 'error', message: 'Something went wrong.' }
}

export function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ReturnType<typeof panelMessage> | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<T>(path))
    } catch (e) {
      setError(panelMessage(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { refetch() }, [refetch])
  return { data, loading, error, refetch }
}

export async function tryAction<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Action failed.' }
  }
}
