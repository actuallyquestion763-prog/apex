import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AdminContactsService } from './admin-contacts.service'
import { CreateAdminContactDto, UpdateAdminContactDto } from './dto/admin-contact.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { MEDIA_UPLOAD_THROTTLE } from '../common/rate-limits'
import { Throttle } from '@nestjs/throttler'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

// Same guard stack as every other admin controller. Not fund-safety-critical
// (a support link, not a receiving address), so no step-up gate here —
// matches the crypto-deposits module's own asset-level (not address-level)
// operations.
@Controller('admin/contacts')
@UseGuards(SessionAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminContactsAdminController {
  constructor(private readonly contacts: AdminContactsService) {}

  @Get()
  @RequirePermissions('admin_contacts.read')
  list() {
    return this.contacts.adminList()
  }

  @Post()
  @RequirePermissions('admin_contacts.control')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('icon'))
  create(@Body() dto: CreateAdminContactDto, @UploadedFile() icon: UploadedFileLike | undefined, @CurrentUser() admin: AuthenticatedUser) {
    return this.contacts.create(admin.id, dto, icon)
  }

  @Patch(':id')
  @RequirePermissions('admin_contacts.control')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('icon'))
  update(@Param('id') id: string, @Body() dto: UpdateAdminContactDto, @UploadedFile() icon: UploadedFileLike | undefined, @CurrentUser() admin: AuthenticatedUser) {
    return this.contacts.update(admin.id, id, dto, icon)
  }

  @Delete(':id')
  @RequirePermissions('admin_contacts.control')
  delete(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.contacts.delete(admin.id, id)
  }
}
