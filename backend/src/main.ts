import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { resolveCorsOrigin, resolveTrustProxy } from './config/security-config'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const env = process.env.NODE_ENV ?? 'development'
  // The stronger version of this check now runs at ConfigModule.forRoot's
  // validate() (src/config/env.validation.ts) and refuses to boot at all â€?  // this only remains as a redundant, harmless startup log.
  if (env === 'production' && !process.env.DATABASE_URL?.includes('prod')) {
    // eslint-disable-next-line no-console
    console.warn('[startup] NODE_ENV=production but DATABASE_URL does not look like a prod database. Refusing to start against what may be the wrong environment is safer than guessing â€?verify your config.')
  }

  // Must be set before anything reads req.ip (rate limiting, logging) â€?  // see resolveTrustProxy's own comment for why this matters in production.
  // Accessed via the underlying Express instance rather than app.set()
  // directly, since NestFactory.create() here returns the platform-agnostic
  // INestApplication type, which doesn't expose Express-specific methods.
  app.getHttpAdapter().getInstance().set('trust proxy', resolveTrustProxy(env))

  // HSTS only makes sense once requests are actually served over HTTPS â€?  // sending it in development/test (plain HTTP) is harmless in practice
  // (browsers ignore Strict-Transport-Security received over HTTP) but
  // asserting an HTTPS guarantee the app isn't making yet is misleading and
  // inconsistent with how every other env-conditioned security setting in
  // this codebase behaves (see resolveCorsOrigin/getCookieOptions/
  // resolveTrustProxy in security-config.ts, all explicitly branched on env).
  app.use(helmet(env === 'production' ? {} : { hsts: false }))
  app.use(cookieParser())

  // Checkpoint I.1, Part 5 â€?a stable correlation id for every request,
  // generated server-side (never trusted from an inbound header â€?accepting
  // a caller-supplied id would let an external actor plant an arbitrary
  // value into our own logs). Echoed back so a client/support ticket can
  // reference it.
  app.use((req: Request, res: Response, next: NextFunction) => {
    ;(req as Request & { requestId?: string }).requestId = randomUUID()
    res.setHeader('X-Request-Id', (req as Request & { requestId?: string }).requestId!)
    next()
  })
  app.useGlobalInterceptors(new LoggingInterceptor())

  app.enableCors({
    origin: resolveCorsOrigin(env, process.env.FRONTEND_ORIGIN),
    credentials: true,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.useGlobalFilters(new AllExceptionsFilter())

  // Checkpoint I.1, Part 2 â€?graceful shutdown. enableShutdownHooks() makes
  // Nest listen for the given signals and, on receipt, call app.close():
  // the underlying HTTP server stops accepting NEW connections (Node's
  // http.Server#close default behavior) while in-flight requests finish,
  // then every module's onModuleDestroy hook runs â€?this is what actually
  // closes PrismaService's connection cleanly (see prisma.service.ts) rather
  // than the process being killed mid-query. No custom SIGTERM/SIGINT
  // handler is needed on top of this; Nest's own hook IS the handler.
  // Financial safety: no code path starts a NEW order/deposit/withdrawal
  // operation during shutdown â€?createOrder() etc. only ever run inside a
  // request handler, and once the server has stopped accepting connections
  // no new request handler can start. In-flight financial operations that
  // are already inside an advisory-locked transaction run to completion
  // (Postgres, not Node, owns that transaction) or roll back atomically if
  // the process is killed before COMMIT â€?never left half-applied.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'])

  const port = process.env.PORT ? Number(process.env.PORT) : 4100
  await app.listen(port, '0.0.0.0')
  // eslint-disable-next-line no-console
  console.log(`[trust-backend] listening on http://localhost:${port} (env=${env})`)
  // eslint-disable-next-line no-console
  console.log('[trust-backend] NOT connected to a real payment provider, broker/exchange, or KYC provider.')
}

bootstrap()
