import { GoldApiProvider } from './goldapi.provider'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

// Phase 6F Checkpoint G, Part 17/19 — GoldApiProvider had no dedicated unit
// test before this checkpoint (only exercised indirectly through
// market-data.service.spec.ts's FakeProvider, which never touches the real
// header/URL/error-message construction this file is responsible for). The
// one property Part 17 explicitly requires — the API key must never appear
// in a thrown error, a log line, or a request URL — was previously
// unverified by any automated test.
describe('GoldApiProvider', () => {
  const REAL_ENV = process.env.MARKET_API_KEY

  afterEach(() => {
    process.env.MARKET_API_KEY = REAL_ENV
    jest.restoreAllMocks()
  })

  it('1. sends the API key only as a request header, never in the URL', async () => {
    process.env.MARKET_API_KEY = 'secret-test-key-do-not-leak-12345'
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      expect(url).not.toContain('secret-test-key-do-not-leak-12345') // never in the URL
      expect((init?.headers as Record<string, string>)['x-access-token']).toBe('secret-test-key-do-not-leak-12345')
      return jsonResponse({ price: 2400, bid: 2399.5, ask: 2400.5, timestamp: Math.floor(Date.now() / 1000) })
    })
    global.fetch = fetchMock as any
    const provider = new GoldApiProvider()
    const result = await provider.getQuote({ providerSymbol: 'XAU/USD' })
    expect(result.last).toBe(2400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('2. a thrown error for a failed request never includes the API key value', async () => {
    process.env.MARKET_API_KEY = 'secret-test-key-do-not-leak-67890'
    global.fetch = jest.fn(async () => jsonResponse({}, false, 401)) as any
    const provider = new GoldApiProvider()
    await expect(provider.getQuote({ providerSymbol: 'XAU/USD' })).rejects.toThrow(/authentication failed/i)
    try {
      await provider.getQuote({ providerSymbol: 'XAU/USD' })
    } catch (err) {
      expect(String(err)).not.toContain('secret-test-key-do-not-leak-67890')
    }
  })

  it('3. missing MARKET_API_KEY throws without ever suggesting what a real key looks like', async () => {
    delete process.env.MARKET_API_KEY
    const provider = new GoldApiProvider()
    await expect(provider.getQuote({ providerSymbol: 'XAU/USD' })).rejects.toThrow('MARKET_API_KEY is not configured')
  })

  it('4. distinguishes rate-limit (429) and server-error (5xx) failures, matching Part 16', async () => {
    process.env.MARKET_API_KEY = 'k'
    const provider = new GoldApiProvider()
    global.fetch = jest.fn(async () => jsonResponse({}, false, 429)) as any
    await expect(provider.getQuote({ providerSymbol: 'XAU/USD' })).rejects.toThrow(/rate limited/i)
    global.fetch = jest.fn(async () => jsonResponse({}, false, 503)) as any
    await expect(provider.getQuote({ providerSymbol: 'XAU/USD' })).rejects.toThrow(/server error/i)
  })

  it('5. healthCheck reports false when no credential is configured, without making a request', async () => {
    delete process.env.MARKET_API_KEY
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any
    const provider = new GoldApiProvider()
    expect(await provider.healthCheck()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
