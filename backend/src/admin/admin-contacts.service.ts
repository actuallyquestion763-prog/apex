import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { MediaStorageService } from '../cms/media-storage.service'
import type { CreateAdminContactDto, UpdateAdminContactDto } from './dto/admin-contact.dto'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

// Admin-managed customer-facing support contact links (LINE, Telegram, etc.)
// — a small, non-financial content domain, deliberately separate from CMS
// (not marketing/legal content) and from CryptoDepositsService (not a fund
// destination). Icon upload reuses the existing MediaStorageService
// abstraction — never a second, unsafe upload path.
@Injectable()
export class AdminContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorageService,
  ) {}

  // ---- Public read path (customer-facing) ------------------------------------

  async listEnabled() {
    const rows = await this.prisma.adminContact.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
    })
    return rows.map((r) => ({ id: r.id, name: r.name, url: r.url, iconUrl: r.iconStorageKey ? `/contacts/${r.id}/icon` : null }))
  }

  async getIconStream(id: string) {
    const row = await this.prisma.adminContact.findUnique({ where: { id } })
    if (!row || !row.iconStorageKey) throw new NotFoundException('No icon for this contact.')
    return { stream: await this.media.getObjectStream(row.iconStorageKey), storageKey: row.iconStorageKey }
  }

  // ---- Admin CRUD -------------------------------------------------------------

  async adminList() {
    const rows = await this.prisma.adminContact.findMany({ orderBy: { sortOrder: 'asc' } })
    // Same convention as CryptoDepositsService.adminListAssets — never leak
    // the raw opaque storage key to the frontend, which derives the icon URL
    // from the contact id via the public getIcon route instead.
    return rows.map(({ iconStorageKey, ...r }) => ({ ...r, hasIcon: Boolean(iconStorageKey) }))
  }

  async create(adminId: string, dto: CreateAdminContactDto, file?: UploadedFileLike) {
    let iconStorageKey: string | undefined
    if (file) {
      const stored = await this.media.save(file.originalname, file.mimetype, file.buffer)
      iconStorageKey = stored.storageKey
    }
    const created = await this.prisma.adminContact.create({
      data: {
        name: dto.name.trim(),
        url: dto.url.trim(),
        sortOrder: dto.sortOrder ?? 0,
        enabled: dto.enabled ?? false,
        iconStorageKey,
        updatedByAdminId: adminId,
      },
    })
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.ADMIN_CONTACT_CHANGED,
      targetType: 'ADMIN_CONTACT',
      targetId: created.id,
      newState: { name: created.name, url: created.url, enabled: created.enabled, created: true },
    })
    return created
  }

  async update(adminId: string, id: string, dto: UpdateAdminContactDto, file?: UploadedFileLike) {
    const before = await this.prisma.adminContact.findUnique({ where: { id } })
    if (!before) throw new NotFoundException('No such contact.')

    let iconStorageKey = before.iconStorageKey
    if (file) {
      const stored = await this.media.save(file.originalname, file.mimetype, file.buffer)
      iconStorageKey = stored.storageKey
      // Best-effort cleanup of the previous icon — never lets a storage
      // failure block the actual record update (the new icon is already
      // saved and referenced either way).
      if (before.iconStorageKey) await this.media.delete(before.iconStorageKey).catch(() => undefined)
    }

    const updated = await this.prisma.adminContact.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.url !== undefined ? { url: dto.url.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        iconStorageKey,
        updatedByAdminId: adminId,
      },
    })
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.ADMIN_CONTACT_CHANGED,
      targetType: 'ADMIN_CONTACT',
      targetId: updated.id,
      previousState: { name: before.name, url: before.url, enabled: before.enabled },
      newState: { name: updated.name, url: updated.url, enabled: updated.enabled },
    })
    return updated
  }

  // Genuinely safe to hard-delete (unlike a crypto deposit address) — a
  // contact link is never referenced by any historical financial or
  // customer record.
  async delete(adminId: string, id: string) {
    const before = await this.prisma.adminContact.findUnique({ where: { id } })
    if (!before) throw new NotFoundException('No such contact.')
    await this.prisma.adminContact.delete({ where: { id } })
    if (before.iconStorageKey) await this.media.delete(before.iconStorageKey).catch(() => undefined)
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.ADMIN_CONTACT_DELETED,
      targetType: 'ADMIN_CONTACT',
      targetId: id,
      previousState: { name: before.name, url: before.url },
    })
    return { ok: true }
  }
}
