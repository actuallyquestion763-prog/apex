import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import type { PermissionKey } from '../common/permissions'
import { sanitizeText } from '../cms/cms.validation'
import { MediaStorageService } from '../cms/media-storage.service'
import type { CreateTicketDto, CreateMessageDto } from './dto/ticket.dto'
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto'

type UploadedFileLike = { originalname: string; mimetype: string; buffer: Buffer }

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'],
  WAITING_INTERNAL: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'], // reopen a resolved ticket back to IN_PROGRESS
  CLOSED: ['OPEN'], // reopening a closed ticket is an explicit staff action
}

/**
 * Financial boundary (Part 17): nothing in this service, or in either
 * SupportController/AdminSupportController, ever imports LedgerService,
 * AccountsService, DepositsService, WithdrawalsService, or AdminService's
 * financial methods. A support agent with every support.* permission
 * granted still cannot move a single dollar — that requires a completely
 * separate set of financial permissions (ledger.adjust, withdrawals.review,
 * etc.) checked by PermissionsGuard on the financial controllers, which
 * this module never touches.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorageService,
  ) {}

  // ---- Categories -----------------------------------------------------------------

  listActiveCategories() {
    return this.prisma.supportCategory.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })
  }

  listAllCategories() {
    return this.prisma.supportCategory.findMany({ orderBy: { order: 'asc' } })
  }

  async createCategory(dto: CreateCategoryDto, adminId: string) {
    const category = await this.prisma.supportCategory.create({
      data: { name: sanitizeText(dto.name), description: dto.description ? sanitizeText(dto.description) : undefined, order: dto.order ?? 0 },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.SUPPORT_CATEGORY_CHANGED, targetType: 'SUPPORT_CATEGORY', targetId: category.id, newState: { created: true } })
    return category
  }

  // Deliberately no deleteCategory() — categories referenced by historical
  // tickets must never disappear (Part 9). Deactivate via isActive instead;
  // the FK from SupportTicket.categoryId is RESTRICT at the DB level too, as
  // a second layer independent of this service ever having a delete method.
  async updateCategory(id: string, dto: UpdateCategoryDto, adminId: string) {
    const existing = await this.prisma.supportCategory.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Category not found.')
    const updated = await this.prisma.supportCategory.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? sanitizeText(dto.name) : undefined,
        description: dto.description !== undefined ? sanitizeText(dto.description) : undefined,
        order: dto.order,
        isActive: dto.isActive,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.SUPPORT_CATEGORY_CHANGED, targetType: 'SUPPORT_CATEGORY', targetId: id, previousState: { name: existing.name, isActive: existing.isActive }, newState: { name: updated.name, isActive: updated.isActive } })
    return updated
  }

  // ---- Customer-facing --------------------------------------------------------------

  // Deliberately does not create a SupportNotification: a brand-new ticket
  // has no assigned agent yet, and this system has no all-staff broadcast/
  // subscription concept (Part 16) — any agent with support.tickets.read
  // already sees it immediately in the ticket list. A notification needs an
  // actual individual recipient, not a fabricated one.
  async createTicket(userId: string, dto: CreateTicketDto) {
    const category = await this.prisma.supportCategory.findUnique({ where: { id: dto.categoryId } })
    if (!category || !category.isActive) throw new BadRequestException('Selected category is not available.')

    const requestedPriority = dto.requestedPriority ?? 'NORMAL'
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          userId,
          categoryId: dto.categoryId,
          subject: sanitizeText(dto.subject),
          requestedPriority,
          priority: requestedPriority, // starting point only — staff may change it later, this is not re-derived from requestedPriority again
        },
      })
      await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorId: userId, body: sanitizeText(dto.message), visibility: 'PUBLIC' },
      })
      return ticket
    })
  }

  async listMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, include: { category: true } })
  }

  // Returns the ticket with only PUBLIC messages — INTERNAL notes are
  // filtered out at the query level (not just hidden by the frontend), so
  // there is no response payload for a customer request that ever contains
  // internal-note content in the first place.
  async getTicketForCustomer(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { category: true, messages: { where: { visibility: 'PUBLIC' }, orderBy: { createdAt: 'asc' } } },
    })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    if (ticket.userId !== userId) throw new ForbiddenException('You do not have access to this ticket.')
    return ticket
  }

  async addCustomerMessage(userId: string, ticketId: string, dto: CreateMessageDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    if (ticket.userId !== userId) throw new ForbiddenException('You do not have access to this ticket.')
    if (ticket.status === 'CLOSED') throw new BadRequestException('This ticket is closed. Contact support to reopen it.')

    // A customer message is ALWAYS visibility: PUBLIC — dto.visibility is
    // simply never read here, regardless of what a manipulated request body
    // contains (see support.e2e-spec.ts's internal-note-spoofing test).
    const nextStatus = ticket.status === 'RESOLVED' ? 'IN_PROGRESS' : ticket.status === 'WAITING_FOR_CUSTOMER' ? 'WAITING_INTERNAL' : ticket.status

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: { ticketId, authorId: userId, body: sanitizeText(dto.body), visibility: 'PUBLIC' },
      })
      if (nextStatus !== ticket.status) {
        await tx.supportTicket.update({ where: { id: ticketId }, data: { status: nextStatus as any } })
      }
      return created
    })
    // Notify the assigned agent, if any — an unassigned ticket has no
    // individual staff recipient yet (see createTicket's comment on why
    // ticket creation itself notifies nobody), so this is a no-op until a
    // ticket has been assigned to someone.
    if (ticket.assignedAgentId) {
      await this.notify(ticket.assignedAgentId, ticketId, 'CUSTOMER_REPLIED', `New customer reply on "${ticket.subject}".`)
    }
    return message
  }

  // ---- Staff / admin ------------------------------------------------------------------

  listAllTickets(status?: string) {
    return this.prisma.supportTicket.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { category: true, user: { select: { id: true, email: true, fullName: true } }, assignedAgent: { select: { id: true, email: true, fullName: true } } },
    })
  }

  async getTicketForStaff(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        category: true,
        user: { select: { id: true, email: true, fullName: true, kycStatus: true } },
        assignedAgent: { select: { id: true, email: true, fullName: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, email: true, fullName: true, role: true } } } },
      },
    })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    return ticket
  }

  // A staff reply defaults to PUBLIC (visible to the customer); INTERNAL
  // requires the separate support.tickets.internal_note permission, checked
  // here — not by the route's baseline support.tickets.reply permission
  // alone, since "can reply to customers" and "can write staff-only notes"
  // are deliberately different capabilities (Part 12/13).
  async addStaffMessage(adminId: string, ticketId: string, dto: CreateMessageDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')

    const visibility = dto.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC'
    if (visibility === 'INTERNAL') {
      await this.assertPermission(adminId, 'support.tickets.internal_note')
    } else {
      await this.assertPermission(adminId, 'support.tickets.reply')
    }

    const message = await this.prisma.supportMessage.create({
      data: { ticketId, authorId: adminId, body: sanitizeText(dto.body), visibility },
    })
    if (visibility === 'INTERNAL') {
      await this.audit.record({ actorId: adminId, action: AuditEvent.INTERNAL_NOTE_CREATED, targetType: 'SUPPORT_TICKET', targetId: ticketId })
    } else {
      // Only a PUBLIC reply notifies the customer — an internal note is, by
      // definition, something the customer must never learn even exists.
      await this.notify(ticket.userId, ticketId, 'AGENT_REPLIED', `Support replied on "${ticket.subject}".`)
    }
    return message
  }

  async updateStatus(adminId: string, ticketId: string, status: string, reason?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')

    const allowed = VALID_TRANSITIONS[ticket.status] ?? []
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Cannot transition a ${ticket.status} ticket directly to ${status}.`)
    }

    // Resolve/close are their own permissions, on top of the baseline
    // support.tickets.update the route already requires — see Part 13.
    if (status === 'RESOLVED') await this.assertPermission(adminId, 'support.tickets.resolve')
    if (status === 'CLOSED') await this.assertPermission(adminId, 'support.tickets.close')

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: status as any,
        resolvedAt: status === 'RESOLVED' ? new Date() : status === 'IN_PROGRESS' && ticket.status === 'RESOLVED' ? null : undefined,
        closedAt: status === 'CLOSED' ? new Date() : undefined,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.TICKET_STATUS_CHANGED, targetType: 'SUPPORT_TICKET', targetId: ticketId, previousState: { status: ticket.status }, newState: { status }, reason })

    // RESOLVED and CLOSED-then-reopened-to-OPEN get their own named events
    // (Part 16's required list treats them as distinct from a generic status
    // change); every other transition notifies as a plain STATUS_CHANGED.
    const event = status === 'RESOLVED' ? 'TICKET_RESOLVED' : ticket.status === 'CLOSED' && status === 'OPEN' ? 'TICKET_REOPENED' : 'STATUS_CHANGED'
    await this.notify(ticket.userId, ticketId, event, `Your ticket "${ticket.subject}" is now ${status.replace(/_/g, ' ')}.`)
    return updated
  }

  async updatePriority(adminId: string, ticketId: string, priority: string, reason?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    const updated = await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { priority: priority as any } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.TICKET_PRIORITY_CHANGED, targetType: 'SUPPORT_TICKET', targetId: ticketId, previousState: { priority: ticket.priority }, newState: { priority }, reason })
    return updated
  }

  async assignTicket(adminId: string, ticketId: string, agentId: string, reason?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    const agent = await this.prisma.user.findUnique({ where: { id: agentId } })
    if (!agent || agent.role === 'USER') throw new BadRequestException('Assignee must be an admin/support-staff account.')

    const updated = await this.prisma.$transaction(async (tx) => {
      // Close out the previous open assignment (if any) rather than
      // deleting it — preserves the full assignment trail (Part 14).
      await tx.supportAssignment.updateMany({
        where: { ticketId, unassignedAt: null },
        data: { unassignedAt: new Date() },
      })
      await tx.supportAssignment.create({
        data: { ticketId, agentId, assignedByAdminId: adminId },
      })
      const result = await tx.supportTicket.update({ where: { id: ticketId }, data: { assignedAgentId: agentId } })
      await this.audit.record({ actorId: adminId, action: AuditEvent.TICKET_ASSIGNED, targetType: 'SUPPORT_TICKET', targetId: ticketId, previousState: { assignedAgentId: ticket.assignedAgentId }, newState: { assignedAgentId: agentId }, reason })
      return result
    })
    await this.notify(agentId, ticketId, 'TICKET_ASSIGNED', `You were assigned ticket "${ticket.subject}".`)
    return updated
  }

  async listAssignmentHistory(ticketId: string) {
    return this.prisma.supportAssignment.findMany({ where: { ticketId }, orderBy: { assignedAt: 'desc' }, include: { agent: { select: { id: true, email: true, fullName: true } }, assignedBy: { select: { id: true, email: true, fullName: true } } } })
  }

  // Staff who can be assigned a ticket — any ADMIN/SUPER_ADMIN account, not
  // filtered by which support.* permissions they hold (an assigner decides
  // who's the right person; this just needs to exclude plain customers).
  // Gated by support.tickets.assign at the route, same as assignTicket
  // itself — deliberately does NOT require admins.read (a separate,
  // financial-admin-adjacent permission domain this module never reaches
  // into, consistent with the module's financial-boundary design).
  listAssignableAgents() {
    return this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true, email: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    })
  }

  // ---- Notifications (Part 16) -----------------------------------------------------

  private async notify(userId: string, ticketId: string, event: string, message: string) {
    await this.prisma.supportNotification.create({ data: { userId, ticketId, event, message } })
  }

  listMyNotifications(userId: string) {
    return this.prisma.supportNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  // With no `ids`, marks every one of the caller's own unread notifications
  // read — always scoped to userId in the WHERE clause, so this can never
  // touch another user's notifications no matter what ids are supplied
  // (updateMany silently matches zero rows for an id that isn't both
  // unread AND owned by this user, rather than erroring — the safe default
  // for a "mark read" action).
  async markNotificationsRead(userId: string, ids?: string[]) {
    await this.prisma.supportNotification.updateMany({
      where: { userId, readAt: null, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    })
    return { ok: true }
  }

  // ---- Attachments (Part 15) ---------------------------------------------------------
  // Reuses MediaStorageService exactly as CmsMedia does — same allowlist,
  // size limit, magic-byte check, random storage key. Unlike CmsMedia,
  // bytes are only ever returned via getAttachmentFile()'s ownership/
  // permission check below — there is no public URL for a support
  // attachment.

  async addAttachmentAsCustomer(userId: string, ticketId: string, file: UploadedFileLike, body?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')
    if (ticket.userId !== userId) throw new ForbiddenException('You do not have access to this ticket.')
    if (ticket.status === 'CLOSED') throw new BadRequestException('This ticket is closed. Contact support to reopen it.')

    const message = await this.createMessageWithAttachment(ticketId, userId, 'PUBLIC', file, body)
    if (ticket.assignedAgentId) {
      await this.notify(ticket.assignedAgentId, ticketId, 'CUSTOMER_REPLIED', `New customer reply on "${ticket.subject}".`)
    }
    return message
  }

  async addAttachmentAsStaff(adminId: string, ticketId: string, file: UploadedFileLike, visibility: 'PUBLIC' | 'INTERNAL', body?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new NotFoundException('Ticket not found.')

    if (visibility === 'INTERNAL') {
      await this.assertPermission(adminId, 'support.tickets.internal_note')
    } else {
      await this.assertPermission(adminId, 'support.tickets.reply')
    }

    const message = await this.createMessageWithAttachment(ticketId, adminId, visibility, file, body)
    if (visibility === 'INTERNAL') {
      await this.audit.record({ actorId: adminId, action: AuditEvent.INTERNAL_NOTE_CREATED, targetType: 'SUPPORT_TICKET', targetId: ticketId })
    } else {
      await this.notify(ticket.userId, ticketId, 'AGENT_REPLIED', `Support replied on "${ticket.subject}".`)
    }
    return message
  }

  private async createMessageWithAttachment(ticketId: string, authorId: string, visibility: 'PUBLIC' | 'INTERNAL', file: UploadedFileLike, body?: string) {
    const safeName = sanitizeText(file.originalname).slice(0, 200) || 'attachment'
    const { storageKey, size } = this.media.save(file.originalname, file.mimetype, file.buffer)
    return this.prisma.supportMessage.create({
      data: {
        ticketId,
        authorId,
        visibility,
        body: body ? sanitizeText(body) : `Attached: ${safeName}`,
        attachments: {
          create: { filename: safeName, mimeType: file.mimetype, size, storageKey, uploadedByUserId: authorId },
        },
      },
      include: { attachments: true },
    })
  }

  // Authorization here is deliberately NOT route-decorator-based (same
  // reasoning as addStaffMessage): the ticket owner may always fetch their
  // own attachments; anyone else needs support.tickets.read. No public URL
  // exists for a support attachment (contrast CmsMedia, which is
  // intentionally public) — this is the only path to the bytes.
  async getAttachmentFile(requesterId: string, attachmentId: string) {
    const attachment = await this.prisma.supportAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { include: { ticket: true } } },
    })
    if (!attachment) throw new NotFoundException('Attachment not found.')
    const ticket = attachment.message.ticket
    if (ticket.userId !== requesterId) {
      await this.assertPermission(requesterId, 'support.tickets.read')
    }
    return { path: this.media.pathFor(attachment.storageKey), mimeType: attachment.mimeType, filename: attachment.filename }
  }

  // Mirrors PermissionsGuard's own check (SUPER_ADMIN bypasses; ADMIN needs
  // an explicit grant) for the cases above where the required permission
  // depends on a value in the request body (target status, message
  // visibility) rather than being fixed at route-definition time, so the
  // declarative @RequirePermissions() decorator alone can't express it.
  private async assertPermission(userId: string, permission: PermissionKey) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.role === 'SUPER_ADMIN') return
    const granted = await this.prisma.userPermission.findFirst({ where: { userId, permission: { key: permission } } })
    if (!granted) throw new ForbiddenException(`Missing required permission(s): ${permission}`)
  }
}
