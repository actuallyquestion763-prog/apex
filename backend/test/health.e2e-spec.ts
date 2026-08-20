import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// Checkpoint I.1, Part 1 — GET /health and GET /health/ready.
describe('Health endpoints (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health reports the process alive without touching the database', async () => {
    const res = await request(server).get('/health').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.environment).toBe('test')
    expect(typeof res.body.timestamp).toBe('string')
  })

  it('GET /health/ready reports database=ok and the FAKE execution provider under the test environment', async () => {
    const res = await request(server).get('/health/ready').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.checks.database).toBe('ok')
    expect(res.body.checks.executionProvider).toBe('FAKE')
  })

  it('GET /health/ready returns 503 with a safe body, never a stack trace, when the database is unavailable', async () => {
    const spy = jest.spyOn(prisma, '$queryRaw' as any).mockRejectedValueOnce(new Error('connection terminated unexpectedly'))
    const res = await request(server).get('/health/ready').expect(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.checks.database).toBe('unavailable')
    expect(JSON.stringify(res.body)).not.toMatch(/at Object\.|at Function\.|node_modules|\.ts:\d+:\d+|connection terminated unexpectedly/)
    spy.mockRestore()
  })

  it('neither health route ever leaks secrets, connection strings, or credentials', async () => {
    const [live, ready] = await Promise.all([request(server).get('/health'), request(server).get('/health/ready')])
    const combined = `${JSON.stringify(live.body)} ${JSON.stringify(ready.body)}`
    expect(combined).not.toMatch(/postgresql:\/\/|SESSION_SECRET|BINANCE|password|apiKey|apiSecret/i)
  })

  it('GET /health requires no authentication (an orchestrator/load balancer has no session)', async () => {
    await request(server).get('/health').expect(200)
    await request(server).get('/health/ready').expect(200)
  })
})
