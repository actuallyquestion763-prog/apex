import { Module } from '@nestjs/common'
import type { AppEnv } from '../config/env.validation'
import { FakeExecutionProvider } from './providers/fake-execution.provider'
import { createExecutionProvider } from './execution-provider.factory'
import { EXECUTION_PROVIDER } from './execution.tokens'

export { EXECUTION_PROVIDER }

// No business-logic module depends on this yet (Checkpoint B is
// infrastructure only — see the Step 11 instruction not to wire settlement
// here). Registered in AppModule regardless so the factory's environment
// safety gate is exercised by every real app boot, including in e2e tests
// under NODE_ENV=test — the same way env.validation.ts's checks are
// exercised just by an app starting up, not by a dedicated code path.
@Module({
  providers: [
    FakeExecutionProvider,
    {
      provide: EXECUTION_PROVIDER,
      useFactory: (fake: FakeExecutionProvider) =>
        createExecutionProvider({
          nodeEnv: (process.env.NODE_ENV as AppEnv | undefined) ?? 'development',
          requestedProvider: process.env.EXECUTION_PROVIDER,
          binanceSandboxApiKey: process.env.BINANCE_SANDBOX_API_KEY,
          binanceSandboxApiSecret: process.env.BINANCE_SANDBOX_API_SECRET,
          fakeProviderInstance: fake,
        }),
      inject: [FakeExecutionProvider],
    },
  ],
  exports: [EXECUTION_PROVIDER, FakeExecutionProvider],
})
export class ExecutionModule {}
