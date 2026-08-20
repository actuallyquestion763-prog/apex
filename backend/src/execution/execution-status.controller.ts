import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { EXECUTION_PROVIDER } from './execution.tokens'
import type { ExecutionProvider } from './execution-provider.types'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'

// Trade Experience checkpoint, Part 5 — lets the frontend show an honest,
// environment-aware disclaimer instead of a hardcoded claim. Reports the
// REAL constructed provider's own `name` (set once at boot by
// execution-provider.factory.ts) rather than re-deriving from env vars here
// — this can never drift from what OrdersService is actually calling.
// Never returns API keys/secrets; ExecutionProvider implementations don't
// expose them on any property this endpoint touches.
export interface ExecutionStatus {
  provider: 'Fake' | 'BinanceSandbox' | 'Disabled'
  message: string
}

function messageFor(name: string): string {
  switch (name) {
    case 'BinanceSandbox':
      return 'Sandbox trading — orders are sent to Binance Testnet using test assets. No real funds are used.'
    case 'Disabled':
      return 'Live execution is disabled.'
    default:
      return 'Simulation mode — orders are simulated locally and do not reach an exchange.'
  }
}

@Controller('execution')
@UseGuards(SessionAuthGuard)
export class ExecutionStatusController {
  constructor(@Inject(EXECUTION_PROVIDER) private readonly provider: ExecutionProvider) {}

  @Get('status')
  getStatus(): ExecutionStatus {
    const provider = this.provider.name as ExecutionStatus['provider']
    return { provider, message: messageFor(provider) }
  }
}
