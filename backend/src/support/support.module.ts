import { Module } from '@nestjs/common'
import { SupportService } from './support.service'
import { SupportController } from './support.controller'
import { AuditModule } from '../audit/audit.module'
import { CmsModule } from '../cms/cms.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { EmailModule } from '../email/email.module'

// Imports CmsModule solely to reuse its exported MediaStorageService for
// support attachments (Part 15) — the same storage abstraction, not a
// second one. Does NOT import CmsService or anything CMS-content-related;
// this remains a separate module from CMS in every other respect.
// PlatformSettingsModule is imported solely to read the support
// auto-greeting configuration (Part: Customer Support redesign) and the
// ADMIN NOTIFICATIONS recipient address — never to write either (that
// stays admin-only, via AdminService.updatePlatformSettings). EmailModule
// is imported to reuse the existing SMTP EmailService for admin
// notification emails — no second email provider/mechanism.
@Module({
  imports: [AuditModule, CmsModule, PlatformSettingsModule, EmailModule],
  providers: [SupportService],
  controllers: [SupportController],
  exports: [SupportService],
})
export class SupportModule {}
