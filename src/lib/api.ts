// Thin fetch wrapper for the TRUST secure backend (backend/). Every call
// sends credentials (the httpOnly session cookie) and never touches
// localStorage — the backend is the only source of truth for anything this
// client asks for. Proxied through Vite as /api -> the backend (see
// vite.config.ts), so this stays same-origin in the browser.

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    // Network-level failure (backend unreachable) — never silently fall back
    // to a cached/local value for financial data. Callers surface this as a
    // connection/error state, not a stale balance.
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', null)
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'message' in data && typeof (data as any).message === 'string')
      ? (data as any).message
      : `Request failed (${res.status}).`
    throw new ApiError(res.status, message, data)
  }
  return data as T
}

async function requestForm<T>(method: string, path: string, form: FormData): Promise<T> {
  let res: Response
  try {
    // No Content-Type header here on purpose — the browser sets the correct
    // multipart/form-data boundary itself; setting it manually breaks the
    // boundary and the backend's FileInterceptor can't parse the body.
    res = await fetch(`/api${path}`, { method, credentials: 'include', body: form })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', null)
  }
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'message' in data && typeof (data as any).message === 'string')
      ? (data as any).message
      : `Request failed (${res.status}).`
    throw new ApiError(res.status, message, data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  postForm: <T>(path: string, form: FormData) => requestForm<T>('POST', path, form),
}

// The public /cms/media/:id and /support/attachments/:id endpoints stream
// bytes, not JSON — this builds a same-origin, credentialed URL for a plain
// <img src>/<a href> rather than routing that through the JSON api client.
export function mediaUrl(id: string): string {
  return `/api/cms/media/${id}`
}
export function attachmentUrl(id: string): string {
  return `/api/support/attachments/${id}`
}
