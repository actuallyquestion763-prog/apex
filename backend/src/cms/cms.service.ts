import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { MediaStorageService } from './media-storage.service'
import { sanitizeOptionalText, sanitizeText, validateDestination, validateSections } from './cms.validation'
import type { CreatePageDto, UpdatePageDto } from './dto/page.dto'
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto'
import type { CreateFaqDto, UpdateFaqDto } from './dto/faq.dto'
import type { CreateNavigationItemDto, UpdateNavigationItemDto } from './dto/navigation.dto'

// Every mutating admin action here does three things in order: (1) snapshot
// the pre-change state into CmsRevision (skipped only for pure creation,
// which has no "before"), (2) apply the change, (3) record a CONTENT_* event
// via the existing AuditService — the same append-only, DB-immutable trail
// financial admin actions use. Ordinary customer-facing reads never touch
// AuditLog or CmsRevision at all.
@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorageService,
  ) {}

  // ---- Public reads (published content only) -------------------------------

  async getPublishedPage(slug: string) {
    const page = await this.prisma.cmsPage.findFirst({ where: { slug, status: 'PUBLISHED' } })
    if (!page) throw new NotFoundException('Page not found.')
    return page
  }

  async listPublishedAnnouncements(isLoggedIn: boolean) {
    const now = new Date()
    return this.prisma.cmsAnnouncement.findMany({
      where: {
        status: 'PUBLISHED',
        loggedInOnly: isLoggedIn ? undefined : false,
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    })
  }

  async listPublishedFaqs() {
    return this.prisma.cmsFaq.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ category: 'asc' }, { order: 'asc' }] })
  }

  async listActiveNavigation() {
    return this.prisma.cmsNavigationItem.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })
  }

  // ---- Admin: pages -----------------------------------------------------------

  listPages() {
    return this.prisma.cmsPage.findMany({ orderBy: { updatedAt: 'desc' } })
  }

  async getPage(id: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } })
    if (!page) throw new NotFoundException('Page not found.')
    return page
  }

  async createPage(dto: CreatePageDto, adminId: string) {
    const existing = await this.prisma.cmsPage.findUnique({ where: { slug: dto.slug } })
    if (existing) throw new BadRequestException('A page with this slug already exists.')

    const page = await this.prisma.cmsPage.create({
      data: {
        slug: sanitizeText(dto.slug),
        title: sanitizeText(dto.title),
        sections: validateSections(dto.sections) as any,
        seoTitle: sanitizeOptionalText(dto.seoTitle) ?? null,
        seoDescription: sanitizeOptionalText(dto.seoDescription) ?? null,
        createdByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_CREATED, targetType: 'CMS_PAGE', targetId: page.id })
    return page
  }

  async updatePage(id: string, dto: UpdatePageDto, adminId: string) {
    const before = await this.getPage(id)
    await this.snapshotRevision('PAGE', id, before, adminId, dto.reason)

    const updated = await this.prisma.cmsPage.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? sanitizeText(dto.title) : undefined,
        sections: dto.sections !== undefined ? (validateSections(dto.sections) as any) : undefined,
        seoTitle: dto.seoTitle !== undefined ? sanitizeOptionalText(dto.seoTitle) : undefined,
        seoDescription: dto.seoDescription !== undefined ? sanitizeOptionalText(dto.seoDescription) : undefined,
        updatedByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_UPDATED, targetType: 'CMS_PAGE', targetId: id, reason: dto.reason })
    return updated
  }

  async publishPage(id: string, adminId: string, reason?: string) {
    const before = await this.getPage(id)
    await this.snapshotRevision('PAGE', id, before, adminId, reason)
    const updated = await this.prisma.cmsPage.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_PUBLISHED, targetType: 'CMS_PAGE', targetId: id, reason })
    return updated
  }

  async unpublishPage(id: string, adminId: string, reason?: string) {
    const before = await this.getPage(id)
    await this.snapshotRevision('PAGE', id, before, adminId, reason)
    const updated = await this.prisma.cmsPage.update({ where: { id }, data: { status: 'DRAFT', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_UNPUBLISHED, targetType: 'CMS_PAGE', targetId: id, reason })
    return updated
  }

  async archivePage(id: string, adminId: string, reason?: string) {
    const before = await this.getPage(id)
    await this.snapshotRevision('PAGE', id, before, adminId, reason)
    const updated = await this.prisma.cmsPage.update({ where: { id }, data: { status: 'ARCHIVED', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_ARCHIVED, targetType: 'CMS_PAGE', targetId: id, reason })
    return updated
  }

  // ---- Admin: announcements -----------------------------------------------------

  listAnnouncements() {
    return this.prisma.cmsAnnouncement.findMany({ orderBy: { updatedAt: 'desc' } })
  }

  async getAnnouncement(id: string) {
    const row = await this.prisma.cmsAnnouncement.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Announcement not found.')
    return row
  }

  async createAnnouncement(dto: CreateAnnouncementDto, adminId: string) {
    const row = await this.prisma.cmsAnnouncement.create({
      data: {
        title: sanitizeText(dto.title),
        body: sanitizeText(dto.body),
        priority: dto.priority ?? 'NORMAL',
        loggedInOnly: dto.loggedInOnly ?? false,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        createdByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_CREATED, targetType: 'CMS_ANNOUNCEMENT', targetId: row.id })
    return row
  }

  async updateAnnouncement(id: string, dto: UpdateAnnouncementDto, adminId: string) {
    const before = await this.getAnnouncement(id)
    await this.snapshotRevision('ANNOUNCEMENT', id, before, adminId, dto.reason)
    const updated = await this.prisma.cmsAnnouncement.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? sanitizeText(dto.title) : undefined,
        body: dto.body !== undefined ? sanitizeText(dto.body) : undefined,
        priority: dto.priority,
        loggedInOnly: dto.loggedInOnly,
        startAt: dto.startAt !== undefined ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt !== undefined ? new Date(dto.endAt) : undefined,
        updatedByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_UPDATED, targetType: 'CMS_ANNOUNCEMENT', targetId: id, reason: dto.reason })
    return updated
  }

  async publishAnnouncement(id: string, adminId: string, reason?: string) {
    const before = await this.getAnnouncement(id)
    await this.snapshotRevision('ANNOUNCEMENT', id, before, adminId, reason)
    const updated = await this.prisma.cmsAnnouncement.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_PUBLISHED, targetType: 'CMS_ANNOUNCEMENT', targetId: id, reason })
    return updated
  }

  async unpublishAnnouncement(id: string, adminId: string, reason?: string) {
    const before = await this.getAnnouncement(id)
    await this.snapshotRevision('ANNOUNCEMENT', id, before, adminId, reason)
    const updated = await this.prisma.cmsAnnouncement.update({ where: { id }, data: { status: 'DRAFT', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_UNPUBLISHED, targetType: 'CMS_ANNOUNCEMENT', targetId: id, reason })
    return updated
  }

  async archiveAnnouncement(id: string, adminId: string, reason?: string) {
    const before = await this.getAnnouncement(id)
    await this.snapshotRevision('ANNOUNCEMENT', id, before, adminId, reason)
    const updated = await this.prisma.cmsAnnouncement.update({ where: { id }, data: { status: 'ARCHIVED', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_ARCHIVED, targetType: 'CMS_ANNOUNCEMENT', targetId: id, reason })
    return updated
  }

  // ---- Admin: FAQs --------------------------------------------------------------

  listFaqs() {
    return this.prisma.cmsFaq.findMany({ orderBy: [{ category: 'asc' }, { order: 'asc' }] })
  }

  async getFaq(id: string) {
    const row = await this.prisma.cmsFaq.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('FAQ not found.')
    return row
  }

  async createFaq(dto: CreateFaqDto, adminId: string) {
    const row = await this.prisma.cmsFaq.create({
      data: {
        question: sanitizeText(dto.question),
        answer: sanitizeText(dto.answer),
        category: dto.category ? sanitizeText(dto.category) : undefined,
        order: dto.order ?? 0,
        createdByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_CREATED, targetType: 'CMS_FAQ', targetId: row.id })
    return row
  }

  async updateFaq(id: string, dto: UpdateFaqDto, adminId: string) {
    const before = await this.getFaq(id)
    await this.snapshotRevision('FAQ', id, before, adminId, dto.reason)
    const updated = await this.prisma.cmsFaq.update({
      where: { id },
      data: {
        question: dto.question !== undefined ? sanitizeText(dto.question) : undefined,
        answer: dto.answer !== undefined ? sanitizeText(dto.answer) : undefined,
        category: dto.category !== undefined ? sanitizeText(dto.category) : undefined,
        order: dto.order,
        updatedByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_UPDATED, targetType: 'CMS_FAQ', targetId: id, reason: dto.reason })
    return updated
  }

  async publishFaq(id: string, adminId: string, reason?: string) {
    const before = await this.getFaq(id)
    await this.snapshotRevision('FAQ', id, before, adminId, reason)
    const updated = await this.prisma.cmsFaq.update({ where: { id }, data: { status: 'PUBLISHED', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_PUBLISHED, targetType: 'CMS_FAQ', targetId: id, reason })
    return updated
  }

  async archiveFaq(id: string, adminId: string, reason?: string) {
    const before = await this.getFaq(id)
    await this.snapshotRevision('FAQ', id, before, adminId, reason)
    const updated = await this.prisma.cmsFaq.update({ where: { id }, data: { status: 'ARCHIVED', updatedByAdminId: adminId } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_ARCHIVED, targetType: 'CMS_FAQ', targetId: id, reason })
    return updated
  }

  // ---- Admin: navigation --------------------------------------------------------

  listNavigation() {
    return this.prisma.cmsNavigationItem.findMany({ orderBy: { order: 'asc' } })
  }

  async createNavigationItem(dto: CreateNavigationItemDto, adminId: string) {
    const item = await this.prisma.cmsNavigationItem.create({
      data: { label: sanitizeText(dto.label), destination: validateDestination(dto.destination), order: dto.order ?? 0 },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.NAVIGATION_UPDATED, targetType: 'CMS_NAVIGATION', targetId: item.id, newState: { created: true } })
    return item
  }

  async updateNavigationItem(id: string, dto: UpdateNavigationItemDto, adminId: string) {
    const existing = await this.prisma.cmsNavigationItem.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Navigation item not found.')
    const updated = await this.prisma.cmsNavigationItem.update({
      where: { id },
      data: {
        label: dto.label !== undefined ? sanitizeText(dto.label) : undefined,
        destination: dto.destination !== undefined ? validateDestination(dto.destination) : undefined,
        order: dto.order,
        isActive: dto.isActive,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.NAVIGATION_UPDATED, targetType: 'CMS_NAVIGATION', targetId: id })
    return updated
  }

  // ---- Admin: media ---------------------------------------------------------------

  listMedia() {
    return this.prisma.cmsMedia.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async uploadMedia(file: { originalname: string; mimetype: string; buffer: Buffer }, kind: string, adminId: string) {
    const { storageKey, size } = await this.media.save(file.originalname, file.mimetype, file.buffer)
    const row = await this.prisma.cmsMedia.create({
      data: {
        filename: sanitizeText(file.originalname).slice(0, 200) || 'upload',
        mimeType: file.mimetype,
        size,
        storageKey,
        kind: kind as any,
        uploadedByAdminId: adminId,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.MEDIA_UPLOADED, targetType: 'CMS_MEDIA', targetId: row.id })
    return row
  }

  async deleteMedia(id: string, adminId: string) {
    const row = await this.prisma.cmsMedia.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Media not found.')

    // Part 12: never silently break published content. A page's sections
    // can reference a media file via its public URL (/cms/media/:id) in any
    // link-shaped field (see cms.validation.ts's LINK_FIELD_NAMES). Scanning
    // PUBLISHED pages for that reference is a deliberately simple check —
    // proportionate to this platform's scale, not a generic reference-graph
    // engine — and the safer of the two allowed options (block rather than
    // silently cascade a broken image/link into a live page).
    const publishedPages = await this.prisma.cmsPage.findMany({ where: { status: 'PUBLISHED' } })
    const marker = `/cms/media/${id}`
    const referencedBy = publishedPages.find((p) => JSON.stringify(p.sections).includes(marker))
    if (referencedBy) {
      throw new BadRequestException(`This media is referenced by the published page "${referencedBy.title}" (/${referencedBy.slug}). Unpublish or update that page before deleting this media.`)
    }

    await this.media.delete(row.storageKey)
    await this.prisma.cmsMedia.delete({ where: { id } })
    await this.audit.record({ actorId: adminId, action: AuditEvent.MEDIA_DELETED, targetType: 'CMS_MEDIA', targetId: id })
    return { ok: true }
  }

  // ---- Public media file (Part 11) -------------------------------------------
  // CmsMedia has no draft/private state in this data model — every uploaded
  // row exists specifically to back public site content (hero images, logos,
  // banners, linked PDFs). There is no "private media" concept here, so
  // exposing any valid row's bytes through this controlled, ID-looked-up
  // endpoint (never a bucket URL directly — see MediaStorageService.getObjectStream,
  // which is only ever called with a storageKey this service itself looked
  // up from the database) is the intended behavior, not a gap. A random
  // guess at a nonexistent id gets a 404, same as any other resource. The
  // storage object itself lives in the same private bucket as every other
  // upload category — "public" here is an application-layer decision (this
  // method requires no ownership/permission check, unlike KYC/deposit/support),
  // not a bucket-level ACL, so a misconfigured bucket can never accidentally
  // expose KYC documents, deposit proofs, or support attachments.
  async getMediaFile(id: string) {
    const row = await this.prisma.cmsMedia.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Media not found.')
    const stream = await this.media.getObjectStream(row.storageKey)
    return { stream, mimeType: row.mimeType, filename: row.filename }
  }

  // ---- Revisions ------------------------------------------------------------------

  private async snapshotRevision(entityType: 'PAGE' | 'ANNOUNCEMENT' | 'FAQ', entityId: string, beforeState: unknown, adminId: string, reason?: string) {
    await this.prisma.cmsRevision.create({
      data: { entityType, entityId, snapshot: beforeState as any, changedByAdminId: adminId, reason },
    })
  }

  async listRevisions(entityType: 'PAGE' | 'ANNOUNCEMENT' | 'FAQ', entityId: string) {
    return this.prisma.cmsRevision.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' } })
  }

  async restorePageRevision(pageId: string, revisionId: string, adminId: string, reason?: string) {
    const revision = await this.prisma.cmsRevision.findUnique({ where: { id: revisionId } })
    if (!revision || revision.entityType !== 'PAGE' || revision.entityId !== pageId) throw new NotFoundException('Revision not found for this page.')

    const before = await this.getPage(pageId)
    await this.snapshotRevision('PAGE', pageId, before, adminId, reason ?? 'Restored from a previous revision')

    const snapshot = revision.snapshot as any
    const restored = await this.prisma.cmsPage.update({
      where: { id: pageId },
      data: { title: snapshot.title, sections: snapshot.sections, seoTitle: snapshot.seoTitle, seoDescription: snapshot.seoDescription, updatedByAdminId: adminId },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.CONTENT_RESTORED, targetType: 'CMS_PAGE', targetId: pageId, reason })
    return restored
  }
}
