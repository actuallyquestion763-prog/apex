import { Module } from '@nestjs/common'
import { KycService } from './kyc.service'
import { KycController } from './kyc.controller'
import { AuditModule } from '../audit/audit.module'
import { CmsModule } from '../cms/cms.module'

@Module({
  imports: [AuditModule, CmsModule],
  providers: [KycService],
  controllers: [KycController],
  exports: [KycService],
})
export class KycModule {}
