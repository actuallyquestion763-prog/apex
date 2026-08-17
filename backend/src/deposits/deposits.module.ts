import { Module } from '@nestjs/common'
import { DepositsService } from './deposits.service'
import { DepositsController } from './deposits.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { AuditModule } from '../audit/audit.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'

@Module({
  imports: [LedgerModule, AccountsModule, PlatformSettingsModule, AuditModule, IdempotencyModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
