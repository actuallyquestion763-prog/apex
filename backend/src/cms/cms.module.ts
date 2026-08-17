import { Module } from '@nestjs/common'
import { CmsService } from './cms.service'
import { CmsController } from './cms.controller'
import { MediaStorageService } from './media-storage.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  providers: [CmsService, MediaStorageService],
  controllers: [CmsController],
  exports: [CmsService, MediaStorageService],
})
export class CmsModule {}
