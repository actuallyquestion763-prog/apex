import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from './api'

function mockJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response
}

describe('api error message extraction', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('surfaces a single class-validator message when the backend returns an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockJsonResponse(400, { message: ['reason must be longer than or equal to 5 characters'], error: 'Bad Request', statusCode: 400 }),
    ))
    await expect(api.post('/admin/financial-adjustment', {})).rejects.toMatchObject({
      message: 'reason must be longer than or equal to 5 characters',
      status: 400,
    })
  })

  it('joins multiple validation messages instead of discarding them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockJsonResponse(400, { message: ['amount must be a number string', 'direction must be one of the following values: CREDIT, DEBIT'] }),
    ))
    const err: unknown = await api.post('/x', {}).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('amount must be a number string direction must be one of the following values: CREDIT, DEBIT')
  })

  it('still surfaces a plain string message unchanged (e.g. a manually-thrown exception)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJsonResponse(401, { message: 'Not authenticated.' })))
    await expect(api.get('/whatever')).rejects.toMatchObject({ message: 'Not authenticated.', status: 401 })
  })

  it('falls back to a generic message only when there is truly nothing usable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJsonResponse(500, {})))
    await expect(api.get('/whatever')).rejects.toMatchObject({ message: 'Request failed (500).' })
  })
})
