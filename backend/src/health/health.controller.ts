import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EXECUTION_PROVIDER } from '../execution/execution.module'
import type { ExecutionProvider } from '../execution/execution-provider.types'
import { FakeExecutionProvider } from '../execution/providers/fake-execution.provider'
import { BinanceSandboxProvider } from '../execution/providers/binance-sandbox.provider'
import { DisabledExecutionProvider } from '../execution/providers/disabled-execution.provider'

// Checkpoint I.1, Part 1 — liveness/readiness split, deliberately thin.
//
// GET /health — "is this process alive." No dependency calls (no DB, no
// provider check) on purpose: an orchestrator that restarts a process on a
// failed liveness probe would just restart-loop a perfectly healthy process
// during a transient DB outage, which makes the outage worse, not better.
//
// GET /health/ready — "can this process actually serve traffic right now."
// This is what a load balancer / orchestrator should gate routing on. Checks
// real DB connectivity and reports which execution-provider class is active.
//
// Both routes are unauthenticated (an orchestrator/LB has no session), so
// neither may ever return a credential, connection string, stack trace, or
// any other internal configuration value — only coarse status.
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXECUTION_PROVIDER) private readonly executionProvider: ExecutionProvider,
  ) {}

  @Get()
  liveness() {
    return {
      status: 'ok',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
    }
  }

  @Get('ready')
  async readiness() {
    let databaseOk: boolean
    try {
      await this.prisma.$queryRaw`SELECT 1`
      databaseOk = true
    } catch {
      databaseOk = false
    }

    const body = {
      status: databaseOk ? 'ok' : 'degraded',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseOk ? 'ok' : 'unavailable',
        // Reports only WHICH provider class is wired up (never credentials,
        // never a live external ping to Binance — that's outside what "is
        // this process ready to serve TRUST's own traffic" means). Safe to
        // expose: it never reveals more than what NODE_ENV already implies.
        executionProvider: this.describeExecutionProvider(),
      },
    }

    if (!databaseOk) {
      // 503 with the same safe body — never the raw DB error/stack.
      throw new ServiceUnavailableException(body)
    }
    return body
  }

  private describeExecutionProvider(): string {
    if (this.executionProvider instanceof DisabledExecutionProvider) return 'DISABLED'
    if (this.executionProvider instanceof BinanceSandboxProvider) return 'BINANCE_SANDBOX'
    if (this.executionProvider instanceof FakeExecutionProvider) return 'FAKE'
    return 'UNKNOWN'
  }
}
