import { Module } from '@nestjs/common'
import { DepositsService } from './deposits.service'
import { DepositsController } from './deposits.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { AuditModule } from '../audit/audit.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'
import { CryptoDepositsModule } from '../crypto-deposits/crypto-deposits.module'
import { CmsModule } from '../cms/cms.module'

@Module({
  // CmsModule imported solely to reuse its exported MediaStorageService for
  // deposit-proof uploads (Part 20) — same abstraction SupportModule
  // already reuses for support attachments, not a second storage mechanism.
  imports: [LedgerModule, AccountsModule, PlatformSettingsModule, AuditModule, IdempotencyModule, CryptoDepositsModule, CmsModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
