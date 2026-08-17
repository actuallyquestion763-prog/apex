import { Module } from '@nestjs/common'
import { WithdrawalsService } from './withdrawals.service'
import { WithdrawalsController } from './withdrawals.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { AuditModule } from '../audit/audit.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'

@Module({
  imports: [LedgerModule, AccountsModule, PlatformSettingsModule, AuditModule, IdempotencyModule],
  providers: [WithdrawalsService],
  controllers: [WithdrawalsController],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
