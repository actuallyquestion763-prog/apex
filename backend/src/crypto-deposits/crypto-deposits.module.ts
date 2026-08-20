import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { SecurityModule } from '../common/security/security.module'
import { CryptoDepositsService } from './crypto-deposits.service'
import { CryptoDepositsController } from './crypto-deposits.controller'
import { CryptoDepositsAdminController } from './crypto-deposits-admin.controller'

@Module({
  imports: [AuditModule, SecurityModule],
  providers: [CryptoDepositsService],
  controllers: [CryptoDepositsController, CryptoDepositsAdminController],
  exports: [CryptoDepositsService],
})
export class CryptoDepositsModule {}
