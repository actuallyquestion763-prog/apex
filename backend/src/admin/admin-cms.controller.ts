import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FileInterceptor } from '@nestjs/platform-express'
import { MEDIA_UPLOAD_THROTTLE } from '../common/rate-limits'
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { CmsService } from '../cms/cms.service'
import { CreatePageDto, UpdatePageDto } from '../cms/dto/page.dto'
import { CreateAnnouncementDto, UpdateAnnouncementDto } from '../cms/dto/announcement.dto'
import { CreateFaqDto, UpdateFaqDto } from '../cms/dto/faq.dto'
import { CreateNavigationItemDto, UpdateNavigationItemDto } from '../cms/dto/navigation.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

class ReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}

class MediaKindDto {
  @IsIn(['IMAGE', 'DOCUMENT', 'LOGO', 'BANNER'])
  kind!: string
}

// Minimal shape actually used from the uploaded file — avoids depending on
// @types/multer (not currently a project dependency) just for a type. Matches
// what multer's FileInterceptor actually populates at runtime regardless.
interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

// Same guard stack as AdminController: session -> role (ADMIN/SUPER_ADMIN)
// -> fine-grained permission per route. SUPER_ADMIN bypasses the permission
// check entirely; a fresh ADMIN has none of these granted until a
// SUPER_ADMIN explicitly grants each one.
@Controller('admin/cms')
@UseGuards(SessionAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminCmsController {
  constructor(private readonly cms: CmsService) {}

  // ---- Pages ----------------------------------------------------------------

  @Get('pages')
  @RequirePermissions('cms.pages.read')
  listPages() {
    return this.cms.listPages()
  }

  @Get('pages/:id')
  @RequirePermissions('cms.pages.read')
  getPage(@Param('id') id: string) {
    return this.cms.getPage(id)
  }

  @Post('pages')
  @RequirePermissions('cms.pages.create')
  createPage(@Body() dto: CreatePageDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.createPage(dto, admin.id)
  }

  @Patch('pages/:id')
  @RequirePermissions('cms.pages.update')
  updatePage(@Param('id') id: string, @Body() dto: UpdatePageDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.updatePage(id, dto, admin.id)
  }

  @Post('pages/:id/publish')
  @RequirePermissions('cms.pages.publish')
  publishPage(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.publishPage(id, admin.id, dto.reason)
  }

  @Post('pages/:id/unpublish')
  @RequirePermissions('cms.pages.publish')
  unpublishPage(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.unpublishPage(id, admin.id, dto.reason)
  }

  @Post('pages/:id/archive')
  @RequirePermissions('cms.pages.archive')
  archivePage(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.archivePage(id, admin.id, dto.reason)
  }

  @Get('pages/:id/revisions')
  @RequirePermissions('cms.pages.read')
  listPageRevisions(@Param('id') id: string) {
    return this.cms.listRevisions('PAGE', id)
  }

  @Post('pages/:id/restore/:revisionId')
  @RequirePermissions('cms.pages.update')
  restorePageRevision(@Param('id') id: string, @Param('revisionId') revisionId: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.restorePageRevision(id, revisionId, admin.id, dto.reason)
  }

  // ---- Announcements --------------------------------------------------------

  @Get('announcements')
  @RequirePermissions('cms.announcements.read')
  listAnnouncements() {
    return this.cms.listAnnouncements()
  }

  @Post('announcements')
  @RequirePermissions('cms.announcements.create')
  createAnnouncement(@Body() dto: CreateAnnouncementDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.createAnnouncement(dto, admin.id)
  }

  @Patch('announcements/:id')
  @RequirePermissions('cms.announcements.update')
  updateAnnouncement(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.updateAnnouncement(id, dto, admin.id)
  }

  @Post('announcements/:id/publish')
  @RequirePermissions('cms.announcements.publish')
  publishAnnouncement(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.publishAnnouncement(id, admin.id, dto.reason)
  }

  @Post('announcements/:id/unpublish')
  @RequirePermissions('cms.announcements.publish')
  unpublishAnnouncement(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.unpublishAnnouncement(id, admin.id, dto.reason)
  }

  @Post('announcements/:id/archive')
  @RequirePermissions('cms.announcements.archive')
  archiveAnnouncement(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.archiveAnnouncement(id, admin.id, dto.reason)
  }

  // ---- FAQs -------------------------------------------------------------------

  @Get('faqs')
  @RequirePermissions('cms.faqs.read')
  listFaqs() {
    return this.cms.listFaqs()
  }

  @Post('faqs')
  @RequirePermissions('cms.faqs.create')
  createFaq(@Body() dto: CreateFaqDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.createFaq(dto, admin.id)
  }

  @Patch('faqs/:id')
  @RequirePermissions('cms.faqs.update')
  updateFaq(@Param('id') id: string, @Body() dto: UpdateFaqDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.updateFaq(id, dto, admin.id)
  }

  @Post('faqs/:id/publish')
  @RequirePermissions('cms.faqs.publish')
  publishFaq(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.publishFaq(id, admin.id, dto.reason)
  }

  @Post('faqs/:id/archive')
  @RequirePermissions('cms.faqs.archive')
  archiveFaq(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.archiveFaq(id, admin.id, dto.reason)
  }

  // ---- Navigation ---------------------------------------------------------------

  @Get('navigation')
  @RequirePermissions('cms.navigation.read')
  listNavigation() {
    return this.cms.listNavigation()
  }

  @Post('navigation')
  @RequirePermissions('cms.navigation.update')
  createNavigationItem(@Body() dto: CreateNavigationItemDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.createNavigationItem(dto, admin.id)
  }

  @Patch('navigation/:id')
  @RequirePermissions('cms.navigation.update')
  updateNavigationItem(@Param('id') id: string, @Body() dto: UpdateNavigationItemDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.updateNavigationItem(id, dto, admin.id)
  }

  // ---- Media ----------------------------------------------------------------------

  @Get('media')
  @RequirePermissions('cms.media.read')
  listMedia() {
    return this.cms.listMedia()
  }

  @Post('media')
  @RequirePermissions('cms.media.upload')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file'))
  uploadMedia(@UploadedFile() file: UploadedFileLike, @Body() dto: MediaKindDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.uploadMedia(file, dto.kind, admin.id)
  }

  @Delete('media/:id')
  @RequirePermissions('cms.media.delete')
  deleteMedia(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.cms.deleteMedia(id, admin.id)
  }
}
