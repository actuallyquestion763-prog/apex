// Thin fetch wrapper for the TRUST secure backend (backend/). Every call
// sends credentials (the httpOnly session cookie) and never touches
// localStorage — the backend is the only source of truth for anything this
// client asks for. By default this stays same-origin: in local dev, Vite
// proxies /api -> the backend and STRIPS the /api prefix before forwarding
// (vite.config.ts) — the backend's own routes have no /api prefix at all
// (e.g. POST /auth/login, not POST /api/auth/login). A same-origin production
// deployment needs an equivalent proxy that also strips it. Set
// VITE_API_BASE_URL at build time (e.g. `VITE_API_BASE_URL=https://api.example.com`)
// only when the frontend and backend are deployed on genuinely separate
// origins with no such proxy in between — the backend's cookie (SameSite=None;
// Secure in that case) and CORS (FRONTEND_ORIGIN) config already support this.
// In that case requests go directly to the backend's real, unprefixed routes
// (no proxy left to strip anything), so API_PREFIX is empty. Left unset,
// API_BASE is '' and API_PREFIX is '/api', identical to the original
// same-origin-only behavior.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const API_PREFIX = API_BASE ? '' : '/api'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

// NestJS's default ValidationPipe returns `message` as an ARRAY of strings
// when multiple class-validator rules fail (e.g. ["reason must be longer
// than or equal to 5 characters"]) — only a single manually-thrown
// exception (e.g. UnauthorizedException) returns a plain string. Extracting
// only the string case silently discarded every validation error's actual
// detail, surfacing a useless generic "Request failed (400)" instead.
function extractMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const msg = (data as { message: unknown }).message
    if (typeof msg === 'string') return msg
    if (Array.isArray(msg) && msg.every((m) => typeof m === 'string')) return msg.join(' ')
  }
  return `Request failed (${status}).`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
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
    throw new ApiError(res.status, extractMessage(data, res.status), data)
  }
  return data as T
}

async function requestForm<T>(method: string, path: string, form: FormData): Promise<T> {
  let res: Response
  try {
    // No Content-Type header here on purpose — the browser sets the correct
    // multipart/form-data boundary itself; setting it manually breaks the
    // boundary and the backend's FileInterceptor can't parse the body.
    res = await fetch(`${API_BASE}${API_PREFIX}${path}`, { method, credentials: 'include', body: form })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', null)
  }
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(data, res.status), data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  postForm: <T>(path: string, form: FormData) => requestForm<T>('POST', path, form),
  patchForm: <T>(path: string, form: FormData) => requestForm<T>('PATCH', path, form),
}

// The public /cms/media/:id and /support/attachments/:id endpoints stream
// bytes, not JSON — this builds a credentialed URL for a plain <img src>/
// <a href> rather than routing that through the JSON api client. Cookies are
// sent on these automatically by the browser regardless of API_BASE, subject
// to the same SameSite rules as any other request to the backend.
export function mediaUrl(id: string): string {
  return `${API_BASE}${API_PREFIX}/cms/media/${id}`
}
export function attachmentUrl(id: string): string {
  return `${API_BASE}${API_PREFIX}/support/attachments/${id}`
}
export function kycDocumentUrl(id: string): string {
  return `${API_BASE}${API_PREFIX}/kyc/documents/${id}`
}
export function adminKycDocumentUrl(id: string): string {
  return `${API_BASE}${API_PREFIX}/admin/kyc/documents/${id}`
}
export function cryptoDepositQrUrl(symbol: string, networkCode: string): string {
  return `${API_BASE}${API_PREFIX}/crypto-deposits/assets/${encodeURIComponent(symbol)}/networks/${encodeURIComponent(networkCode)}/qr`
}
export function adminContactIconUrl(id: string): string {
  return `${API_BASE}${API_PREFIX}/contacts/${id}/icon`
}
