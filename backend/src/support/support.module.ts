import { Module } from '@nestjs/common'
import { SupportService } from './support.service'
import { SupportController } from './support.controller'
import { AuditModule } from '../audit/audit.module'
import { CmsModule } from '../cms/cms.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'

// Imports CmsModule solely to reuse its exported MediaStorageService for
// support attachments (Part 15) — the same storage abstraction, not a
// second one. Does NOT import CmsService or anything CMS-content-related;
// this remains a separate module from CMS in every other respect.
// PlatformSettingsModule is imported solely to read the support
// auto-greeting configuration (Part: Customer Support redesign) — never to
// write it (that stays admin-only, via AdminService.updatePlatformSettings).
@Module({
  imports: [AuditModule, CmsModule, PlatformSettingsModule],
  providers: [SupportService],
  controllers: [SupportController],
  exports: [SupportService],
})
export class SupportModule {}
