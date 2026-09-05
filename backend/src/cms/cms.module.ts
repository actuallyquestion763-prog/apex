import { Module } from '@nestjs/common'
import { CmsService } from './cms.service'
import { CmsController } from './cms.controller'
import { MediaStorageService } from './media-storage.service'
import { S3_CLIENT } from './media-storage.tokens'
import { buildS3Client } from './s3-client.factory'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  providers: [
    CmsService,
    MediaStorageService,
    { provide: S3_CLIENT, useFactory: buildS3Client },
  ],
  controllers: [CmsController],
  exports: [CmsService, MediaStorageService],
})
export class CmsModule {}
