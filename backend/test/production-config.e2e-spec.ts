import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp } from './helpers/test-app'

// Phase 5, Part 31 item 12 — proves the REAL `cors` package (wired via
// app.enableCors in test-app.ts, mirroring main.ts) only ever reflects the
// one configured trusted origin, never an arbitrary caller-supplied Origin.
// Complements security-config.spec.ts, which tests resolveCorsOrigin() the
// pure function in isolation; this proves the wiring actually behaves that
// way at the HTTP layer.
describe('CORS (real PostgreSQL app, real cors middleware)', () => {
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

  const TRUSTED_ORIGIN = 'http://localhost:5173' // test-app.ts falls back to this under NODE_ENV=test with no FRONTEND_ORIGIN override

  it('reflects the trusted origin in Access-Control-Allow-Origin', async () => {
    const res = await request(server).get('/cms/faqs').set('Origin', TRUSTED_ORIGIN)
    expect(res.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN)
  })

  it('never reflects an untrusted caller-supplied Origin — the response always carries the ONE fixed trusted value, regardless of what Origin was requested', async () => {
    // A static origin string (as configured here — see resolveCorsOrigin())
    // makes the `cors` package emit the SAME configured value on every
    // response, never the request's own Origin header — there is no
    // reflection logic for an attacker to exploit at all. The actual
    // security boundary is enforced by the BROWSER: a page running on
    // https://evil.example.com receiving an Access-Control-Allow-Origin of
    // "http://localhost:5173" (not matching its own origin) has that
    // response blocked from its JavaScript, regardless of this header
    // technically being present.
    const res = await request(server).get('/cms/faqs').set('Origin', 'https://evil.example.com')
    expect(res.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN)
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com')
  })

  it('credentials are only ever allowed for the trusted origin, never a wildcard', async () => {
    const res = await request(server).get('/cms/faqs').set('Origin', TRUSTED_ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-origin']).not.toBe('*')
  })
})
