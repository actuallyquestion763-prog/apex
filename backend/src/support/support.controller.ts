import { Body, Controller, Get, Param, Patch, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { createReadStream } from 'fs'
import { SupportService } from './support.service'
import { CreateTicketDto, CreateMessageDto, AttachmentBodyDto, MarkNotificationsReadDto } from './dto/ticket.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

// Customer-facing only — any authenticated USER (or ADMIN/SUPER_ADMIN, who
// are also platform users and may want to raise their own ticket) may
// create/view/reply to their OWN tickets. No permission check beyond "is
// this your ticket" — see SupportService, which enforces ownership on every
// read/write here. Nothing on this controller ever lets one customer see or
// touch another customer's data (Part 16), and nothing here can create an
// INTERNAL-visibility message (Part 12) — CreateMessageDto's `visibility` is
// accepted but SupportService.addCustomerMessage() never reads it.
@Controller('support')
@UseGuards(SessionAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('categories')
  listCategories() {
    return this.support.listActiveCategories()
  }

  @Post('tickets')
  createTicket(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user.id, dto)
  }

  @Get('tickets')
  listMyTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listMyTickets(user.id)
  }

  @Get('tickets/:id')
  getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.getTicketForCustomer(user.id, id)
  }

  @Post('tickets/:id/messages')
  addMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateMessageDto) {
    return this.support.addCustomerMessage(user.id, id, dto)
  }

  @Post('tickets/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  addAttachment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @UploadedFile() file: UploadedFileLike, @Body() dto: AttachmentBodyDto) {
    return this.support.addAttachmentAsCustomer(user.id, id, file, dto.body)
  }

  // Shared by both customers (their own tickets) and staff (with
  // support.tickets.read) — SupportService.getAttachmentFile() does the
  // ownership-or-permission check; there is no separate /admin/ route for
  // this because the same authorization logic already covers both callers.
  @Get('attachments/:id')
  async getAttachment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const file = await this.support.getAttachmentFile(user.id, id)
    const stream = createReadStream(file.path)
    return new StreamableFile(stream, { type: file.mimeType, disposition: `attachment; filename="${encodeURIComponent(file.filename)}"` })
  }

  @Get('notifications')
  listNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listMyNotifications(user.id)
  }

  @Patch('notifications/read')
  markNotificationsRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkNotificationsReadDto) {
    return this.support.markNotificationsRead(user.id, dto.ids)
  }
}
