import { Module } from '@nestjs/common'
import { SupportService } from './support.service'
import { SupportController } from './support.controller'
import { AuditModule } from '../audit/audit.module'
import { CmsModule } from '../cms/cms.module'

// Imports CmsModule solely to reuse its exported MediaStorageService for
// support attachments (Part 15) — the same storage abstraction, not a
// second one. Does NOT import CmsService or anything CMS-content-related;
// this remains a separate module from CMS in every other respect.
@Module({
  imports: [AuditModule, CmsModule],
  providers: [SupportService],
  controllers: [SupportController],
  exports: [SupportService],
})
export class SupportModule {}
