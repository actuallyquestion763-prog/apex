import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const env = process.env.NODE_ENV ?? 'development'
  if (env === 'production' && !process.env.DATABASE_URL?.includes('prod')) {
    // Cheap guardrail, not a substitute for real environment separation
    // (separate secrets/credentials per environment) — see .env.example.
    // eslint-disable-next-line no-console
    console.warn('[startup] NODE_ENV=production but DATABASE_URL does not look like a prod database. Refusing to start against what may be the wrong environment is safer than guessing — verify your config.')
  }

  app.use(helmet())
  app.use(cookieParser())

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
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

  const port = process.env.PORT ? Number(process.env.PORT) : 4100
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`[trust-backend] listening on http://localhost:${port} (env=${env})`)
  // eslint-disable-next-line no-console
  console.log('[trust-backend] NOT connected to a real payment provider, broker/exchange, or KYC provider.')
}

bootstrap()
