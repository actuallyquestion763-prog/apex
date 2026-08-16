import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
