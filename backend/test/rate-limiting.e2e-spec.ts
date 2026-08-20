import { Controller, Get, INestApplication, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { Test } from '@nestjs/testing'
import request from 'supertest'

// Rate limiting (Phase 5, Part 15/31 item 10). The real app's throttle
// limits are deliberately raised under NODE_ENV=test (see
// src/common/rate-limits.ts and app.module.ts) so the rest of the e2e suite
// — which legitimately logs in/creates records far more than the
// production limits allow, from one IP, in one test run — doesn't trip
// them. That makes the production-sized limits themselves untestable
// against the real AppModule in this suite. Instead, this builds a
// minimal, isolated Nest app wired with the exact same mechanism
// (ThrottlerModule + ThrottlerGuard as APP_GUARD) production uses, at a
// small, deliberately-testable limit, and proves that mechanism actually
// returns 429 once exceeded — i.e. that the guard is real, not just
// configured and silently inert.
@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true }
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 3 }])],
  controllers: [PingController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class RateLimitTestModule {}

describe('Rate limiting mechanism (isolated)', () => {
  let app: INestApplication
  let server: any

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RateLimitTestModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('allows requests within the limit and rejects with 429 once exceeded', async () => {
    await request(server).get('/ping').expect(200)
    await request(server).get('/ping').expect(200)
    await request(server).get('/ping').expect(200)
    // 4th request within the same 60s window, same IP — over the limit of 3.
    await request(server).get('/ping').expect(429)
  })
})
