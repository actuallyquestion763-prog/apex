import nodemailer from 'nodemailer'
import { EmailService } from './email.service'

jest.mock('nodemailer')

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

function fetchMockReturning(body: unknown, ok = true, status = 200) {
  return jest.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body, ok, status))
}

// EmailService had no dedicated unit test before the Brevo HTTP API path
// was added — this is now the only place that verifies transport
// selection (Brevo API vs SMTP vs "nothing configured"), the Brevo
// request shape, and that the API key never leaks into a thrown error —
// exactly the same property goldapi.provider.spec.ts already verifies for
// MARKET_API_KEY, applied here to BREVO_API_KEY.
describe('EmailService', () => {
  const REAL_ENV = { ...process.env }
  let sendMailMock: jest.Mock

  beforeEach(() => {
    process.env = { ...REAL_ENV }
    delete process.env.BREVO_API_KEY
    delete process.env.SMTP_HOST
    sendMailMock = jest.fn().mockResolvedValue(undefined)
    ;(nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: sendMailMock })
  })

  afterEach(() => {
    process.env = { ...REAL_ENV }
    jest.restoreAllMocks()
  })

  // ---- Transport selection ----------------------------------------------

  it('1. uses the Brevo HTTP API (never nodemailer/SMTP) when BREVO_API_KEY is set, even if SMTP_HOST is also set', async () => {
    process.env.BREVO_API_KEY = 'secret-brevo-key-do-not-leak-12345'
    process.env.SMTP_HOST = 'smtp.example.com'
    const fetchMock = fetchMockReturning({ messageId: 'abc' })
    global.fetch = fetchMock as any

    const service = new EmailService()
    await service.sendPasswordResetEmail('user@example.com', 'https://edgecryptotrade.site/reset?token=xyz', 30)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init as any).headers['api-key']).toBe('secret-brevo-key-do-not-leak-12345')
  })

  it('2. falls back to SMTP via nodemailer when BREVO_API_KEY is unset but SMTP_HOST is set (preserves original behavior)', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const service = new EmailService()
    await service.sendPasswordResetEmail('user@example.com', 'https://edgecryptotrade.site/reset?token=xyz', 30)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0].to).toBe('user@example.com')
  })

  it('3. logs and resolves without throwing when neither BREVO_API_KEY nor SMTP_HOST is configured — a delivery gap must never break the caller', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any
    const service = new EmailService()
    await expect(service.sendPasswordResetEmail('user@example.com', 'https://x/reset', 30)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  // ---- Brevo request shape ------------------------------------------------

  it('4. sends the correct Brevo request shape (sender/to/subject/textContent/htmlContent) for a support notification email', async () => {
    process.env.BREVO_API_KEY = 'brevo-key'
    process.env.EMAIL_FROM = 'EDGETRADE <no-reply@edgecryptotrade.site>'
    const fetchMock = fetchMockReturning({})
    global.fetch = fetchMock as any

    const service = new EmailService()
    await service.sendSupportNotificationEmail('ops@edgecryptotrade.site', {
      kind: 'NEW_TICKET',
      ticketId: '27998d22-05b8-4518-af40-738ff3f2e351',
      ticketSubject: 'Withdrawal missing',
      categoryName: 'Withdrawals',
      customerLabel: 'Jordan Customer',
      messagePreview: 'It has been 3 days.',
      createdAt: new Date('2026-09-13T16:05:00Z'),
      ticketUrl: 'https://edgecryptotrade.site/admin/support?ticket=27998d22-05b8-4518-af40-738ff3f2e351',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as any).body)
    expect(body.sender).toEqual({ email: 'no-reply@edgecryptotrade.site', name: 'EDGETRADE' })
    expect(body.to).toEqual([{ email: 'ops@edgecryptotrade.site' }])
    expect(body.subject).toBe('EDGETRADE — New Support Ticket')
    expect(body.textContent).toContain('Withdrawal missing')
    expect(body.htmlContent).toContain('Withdrawal missing')
  })

  it('5. parses a bare email address (no display name) as EMAIL_FROM correctly', async () => {
    process.env.BREVO_API_KEY = 'brevo-key'
    process.env.EMAIL_FROM = 'no-reply@edgecryptotrade.site'
    const fetchMock = fetchMockReturning({})
    global.fetch = fetchMock as any

    const service = new EmailService()
    await service.sendPasswordResetEmail('user@example.com', 'https://x/reset', 30)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.sender).toEqual({ email: 'no-reply@edgecryptotrade.site' })
  })

  // ---- Failure handling / secrecy -----------------------------------------

  it("6. a non-OK Brevo response throws (so the caller's own try/catch handles it), and the thrown error never contains the API key", async () => {
    process.env.BREVO_API_KEY = 'secret-brevo-key-do-not-leak-67890'
    global.fetch = fetchMockReturning({ message: 'invalid key' }, false, 401) as any
    const service = new EmailService()

    await expect(service.sendPasswordResetEmail('user@example.com', 'https://x/reset', 30)).rejects.toThrow()
    try {
      await service.sendPasswordResetEmail('user@example.com', 'https://x/reset', 30)
    } catch (err) {
      expect(String(err)).not.toContain('secret-brevo-key-do-not-leak-67890')
    }
  })

  it('7. never sends a session cookie, auth token, or the Brevo API key itself as part of the email content', async () => {
    process.env.BREVO_API_KEY = 'secret-brevo-key-do-not-leak-99999'
    const fetchMock = fetchMockReturning({})
    global.fetch = fetchMock as any
    const service = new EmailService()

    await service.sendSupportNotificationEmail('ops@edgecryptotrade.site', {
      kind: 'CUSTOMER_REPLY',
      ticketId: 't1',
      ticketSubject: 'Q',
      categoryName: 'General',
      customerLabel: 'Test User',
      messagePreview: 'hello',
      createdAt: new Date(),
      ticketUrl: 'https://edgecryptotrade.site/admin/support?ticket=t1',
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('secret-brevo-key-do-not-leak-99999')
    expect(serialized).not.toMatch(/session|trust_session|cookie/i)
  })
})
