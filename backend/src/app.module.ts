import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { validateEnv } from './config/env.validation'
import { PrismaModule } from './prisma/prisma.module'
import { AuditModule } from './audit/audit.module'
import { LedgerModule } from './ledger/ledger.module'
import { PlatformSettingsModule } from './platform-settings/platform-settings.module'
import { AccountsModule } from './accounts/accounts.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { MarketsModule } from './markets/markets.module'
import { OrdersModule } from './orders/orders.module'
import { PositionsModule } from './positions/positions.module'
import { DepositsModule } from './deposits/deposits.module'
import { WithdrawalsModule } from './withdrawals/withdrawals.module'
import { KycModule } from './kyc/kyc.module'
import { AdminModule } from './admin/admin.module'
import { CmsModule } from './cms/cms.module'
import { SupportModule } from './support/support.module'
import { ExecutionModule } from './execution/execution.module'
import { ExecutionStatusModule } from './execution/execution-status.module'
import { HealthModule } from './health/health.module'
import { OptionsModule } from './options/options.module'
import { CryptoDepositsModule } from './crypto-deposits/crypto-deposits.module'
import { AdminContactsModule } from './admin/admin-contacts.module'

@Module({
  imports: [
    // validate throws (and prevents the app from booting at all) on the
    // specific misconfigurations Part 2/3 exist to catch — see
    // config/env.validation.ts. NODE_ENV alone was previously only a soft
    // warning in main.ts; this makes it a hard boot-time failure.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        // Applies to every route by default (rate limiting §25 of the spec).
        // Auth endpoints layer a stricter limit via @Throttle(...) if needed
        // as a follow-up — this global limit is the floor, not the ceiling.
        // Raised only under NODE_ENV=test so a full integration-test run
        // (many sequential requests from one IP) doesn't trip it and produce
        // unrelated 429s — never loosened in development/production.
        ttl: 60_000,
        limit: process.env.NODE_ENV === 'test' ? 10_000 : 120,
      },
    ]),
    PrismaModule,
    AuditModule,
    LedgerModule,
    PlatformSettingsModule,
    AccountsModule,
    AuthModule,
    UsersModule,
    MarketsModule,
    OrdersModule,
    PositionsModule,
    DepositsModule,
    WithdrawalsModule,
    KycModule,
    AdminModule,
    CmsModule,
    SupportModule,
    // Infrastructure only this checkpoint (Phase 6F, Checkpoint B) — no
    // business logic depends on EXECUTION_PROVIDER yet. Wired into the real
    // app anyway so its environment safety gate (execution-provider.factory.ts)
    // is exercised by every real boot, including e2e tests under
    // NODE_ENV=test, the same way env.validation.ts's checks are.
    ExecutionModule,
    ExecutionStatusModule,
    // Checkpoint I.1, Part 1 — unauthenticated liveness/readiness endpoints.
    // Registered last only by convention (no ordering dependency); imports
    // PrismaModule/ExecutionModule rather than duplicating their providers.
    HealthModule,
    // Fixed-Time Options Trading — a separate product from spot Orders
    // above; does not import OrdersModule/ExecutionModule and does not
    // touch RiskEngineService (see src/options/ for its own risk/settlement
    // pipeline, deliberately independent).
    OptionsModule,
    // Also imported by DepositsModule (to resolve/snapshot a configuration
    // at deposit-creation time) — listed here too, directly, for the same
    // top-level visibility every other feature module gets.
    CryptoDepositsModule,
    AdminContactsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
