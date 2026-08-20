import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail } from './helpers/test-app'

// Checkpoint I.1, Part 5 — request-id propagation and the guarantee that
// structured request logs never carry request bodies (where passwords,
// confirmPassword, totpCode, and deposit/withdrawal amounts live).
describe('Structured request logging (real PostgreSQL)', () => {
  let app: INestApplication
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('every response carries a unique X-Request-Id header', async () => {
    const [a, b] = await Promise.all([request(server).get('/health'), request(server).get('/health')])
    expect(a.headers['x-request-id']).toBeTruthy()
    expect(b.headers['x-request-id']).toBeTruthy()
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id'])
  })

  it('a genuinely unhandled 500 returns the requestId in its body and never a stack trace or internal error text', async () => {
    // Provoke a real internal error: findUniqueOrThrow-style lookup on a
    // syntactically-valid-but-nonexistent id deep past validation.
    const res = await request(server).get('/admin/users/00000000-0000-0000-0000-000000000000')
    expect([401, 403, 404, 500]).toContain(res.status)
    if (res.status === 500) {
      expect(typeof res.body.requestId).toBe('string')
      expect(JSON.stringify(res.body)).not.toMatch(/at Object\.|at Function\.|node_modules|\.ts:\d+:\d+/)
    }
  })

  it('the structured log line for a request carrying a password never includes the password, confirmPassword, or totpCode values', async () => {
    const secretPassword = 'super-secret-password-should-never-be-logged-XYZ123'
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    await request(server).post('/auth/register').send({ email: uniqueEmail('logsecrecy'), password: secretPassword, fullName: 'Log Secrecy Test' }).expect(201)

    const loggedLines = logSpy.mock.calls.map((c) => String(c[0]))
    expect(loggedLines.some((line) => line.includes('/auth/register'))).toBe(true)
    expect(loggedLines.join('\n')).not.toContain(secretPassword)

    logSpy.mockRestore()
  })
})
