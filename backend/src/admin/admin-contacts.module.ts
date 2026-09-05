import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { CmsModule } from '../cms/cms.module'
import { AdminContactsService } from './admin-contacts.service'
import { ContactsController } from './admin-contacts.controller'
import { AdminContactsAdminController } from './admin-contacts-admin.controller'

@Module({
  imports: [AuditModule, CmsModule],
  providers: [AdminContactsService],
  controllers: [ContactsController, AdminContactsAdminController],
  exports: [AdminContactsService],
})
export class AdminContactsModule {}
