import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { MediaStorageService } from '../cms/media-storage.service'
import { maskIdNumber } from './mask.util'
import type { SubmitKycDto } from './dto/submit-kyc.dto'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

export interface SubmitKycFiles {
  front?: UploadedFileLike[]
  back?: UploadedFileLike[]
  selfie?: UploadedFileLike[]
}

// Real submission + private document storage (extends the previous
// status-tracking-only design). Documents are saved via the existing shared
// MediaStorageService (private S3-compatible bucket, random storage key,
// magic-byte validated) — the exact same mechanism CmsMedia, SupportAttachment,
// and Deposit proofs already use. Never a public URL; every read goes through
// getDocumentFile()/adminGetDocumentFile()'s ownership-or-permission check.
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorageService,
  ) {}

  async submit(userId: string, dto: SubmitKycDto, files: SubmitKycFiles) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.kycStatus === 'PENDING') throw new BadRequestException('A verification is already pending.')
    if (user.kycStatus === 'VERIFIED') throw new BadRequestException('This account is already verified.')

    const front = files.front?.[0]
    const back = files.back?.[0]
    const selfie = files.selfie?.[0]
    // PASSPORT: photo page only. NATIONAL_ID/DRIVERS_LICENSE: both sides.
    // Every ID type requires a selfie (no pre-existing product rule said
    // otherwise — this is a deliberate, disclosed default for this checkpoint).
    const needsBack = dto.idType !== 'PASSPORT'

    if (!front) throw new BadRequestException('Front of ID is required.')
    if (needsBack && !back) throw new BadRequestException('Back of ID is required for this ID type.')
    if (!needsBack && back) throw new BadRequestException(`${dto.idType} does not require a back image.`)
    if (!selfie) throw new BadRequestException('A verification selfie is required.')

    const isResubmission = user.kycStatus === 'REJECTED'

    // Storage writes happen before the DB transaction (same ordering as
    // DepositsService.uploadProof) — a transaction failure after a
    // successful upload can leave an orphaned object; this is a pre-existing,
    // accepted tradeoff carried over unchanged from the local-disk version,
    // not something this storage-backend swap needed to fix.
    const storedFront = await this.media.save(front.originalname, front.mimetype, front.buffer)
    const storedBack = back ? await this.media.save(back.originalname, back.mimetype, back.buffer) : null
    const storedSelfie = await this.media.save(selfie.originalname, selfie.mimetype, selfie.buffer)

    const documents = [
      { kind: 'FRONT' as const, storageKey: storedFront.storageKey, mimeType: front.mimetype, filename: front.originalname, size: storedFront.size },
      ...(storedBack ? [{ kind: 'BACK' as const, storageKey: storedBack.storageKey, mimeType: back!.mimetype, filename: back!.originalname, size: storedBack.size }] : []),
      { kind: 'SELFIE' as const, storageKey: storedSelfie.storageKey, mimeType: selfie.mimetype, filename: selfie.originalname, size: storedSelfie.size },
    ]

    const [verification] = await this.prisma.$transaction([
      this.prisma.kycVerification.create({
        data: {
          userId,
          status: 'PENDING',
          fullName: dto.fullName,
          dateOfBirth: new Date(dto.dateOfBirth),
          country: dto.country,
          idType: dto.idType,
          idNumber: dto.idNumber,
          documents: { create: documents },
        },
        include: { documents: { select: { id: true, kind: true } } },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } }),
    ])

    // Never log filenames or any document content for identity documents
    // (Part 22/23) — only which kinds were uploaded, against which submission.
    await this.audit.record({ actorId: userId, action: AuditEvent.KYC_SUBMITTED, targetType: 'USER', targetId: userId, metadata: { verificationId: verification.id, idType: dto.idType } })
    await this.audit.record({ actorId: userId, action: AuditEvent.KYC_DOCUMENT_UPLOADED, targetType: 'USER', targetId: userId, metadata: { verificationId: verification.id, documentKinds: documents.map((d) => d.kind) } })
    if (isResubmission) {
      await this.audit.record({ actorId: userId, action: AuditEvent.KYC_RESUBMITTED, targetType: 'USER', targetId: userId, metadata: { verificationId: verification.id } })
    }

    return verification
  }

  // Latest submission for the authenticated user — Mine/Profile + KYC page
  // status source. Returns null if the user has never submitted.
  async getMine(userId: string) {
    return this.prisma.kycVerification.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      include: { documents: { select: { id: true, kind: true } } },
    })
  }

  // Ownership-gated document access for the submitting user themselves —
  // never a public URL, mirrors DepositsService.getProofFile exactly.
  async getDocumentFile(requesterId: string, documentId: string) {
    const doc = await this.prisma.kycDocument.findUnique({ where: { id: documentId }, include: { verification: true } })
    if (!doc) throw new NotFoundException('Document not found.')
    if (doc.verification.userId !== requesterId) throw new NotFoundException('Document not found.')
    const stream = await this.media.getObjectStream(doc.storageKey)
    return { stream, mimeType: doc.mimeType, filename: doc.filename }
  }

  // ---- Admin -----------------------------------------------------------

  // Kept unchanged (existing behavior/tests) — the Overview stat and the
  // original pending-only quick-review flow both still use this.
  async listPending() {
    return this.prisma.kycVerification.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    })
  }

  // Full dashboard (Part 15) — every status, not just PENDING. idNumber is
  // masked here (Part 23); the single-submission detail view below shows it
  // in full to an already-permission-checked reviewer.
  async adminListAll() {
    const rows = await this.prisma.kycVerification.findMany({
      orderBy: { submittedAt: 'desc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    })
    return rows.map((r) => ({ ...r, idNumber: maskIdNumber(r.idNumber) }))
  }

  async adminGetSubmission(id: string) {
    const row = await this.prisma.kycVerification.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        documents: { select: { id: true, kind: true, mimeType: true, filename: true, size: true, createdAt: true } },
      },
    })
    if (!row) throw new NotFoundException('Submission not found.')
    return row
  }

  // Audited on every admin view (Part 22) — self-views via getDocumentFile()
  // above are deliberately not audited (not a reviewable security event).
  async adminGetDocumentFile(adminId: string, documentId: string) {
    const doc = await this.prisma.kycDocument.findUnique({ where: { id: documentId }, include: { verification: true } })
    if (!doc) throw new NotFoundException('Document not found.')
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.KYC_DOCUMENT_VIEWED,
      targetType: 'USER',
      targetId: doc.verification.userId,
      metadata: { verificationId: doc.verificationId, documentId, kind: doc.kind },
    })
    const stream = await this.media.getObjectStream(doc.storageKey)
    return { stream, mimeType: doc.mimeType, filename: doc.filename }
  }

  async approve(verificationId: string, adminId: string) {
    const verification = await this.prisma.kycVerification.findUnique({ where: { id: verificationId }, include: { documents: true } })
    if (!verification) throw new NotFoundException('Verification not found.')
    if (verification.status === 'VERIFIED') return verification // idempotent no-op

    // Guards against approving a legacy pre-checkpoint row (created via the
    // old provider-only submit(), before real identity data/documents were
    // collected) — Part 20's "required information is complete" / "required
    // documents are present" checks, made explicit rather than assumed.
    if (!verification.fullName || !verification.idType || !verification.idNumber || verification.documents.length === 0) {
      throw new BadRequestException('This submission is missing required identity information or documents and cannot be approved.')
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycVerification.update({
        where: { id: verificationId },
        data: { status: 'VERIFIED', reviewedAt: new Date(), reviewedByAdminId: adminId },
      }),
      this.prisma.user.update({ where: { id: verification.userId }, data: { kycStatus: 'VERIFIED' } }),
    ])

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.KYC_APPROVED,
      targetType: 'USER',
      targetId: verification.userId,
      previousState: { status: verification.status },
      newState: { status: 'VERIFIED' },
    })

    return updated
  }

  async reject(verificationId: string, adminId: string, reason: string) {
    const verification = await this.prisma.kycVerification.findUnique({ where: { id: verificationId } })
    if (!verification) throw new NotFoundException('Verification not found.')
    if (verification.status === 'REJECTED') return verification // idempotent no-op

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycVerification.update({
        where: { id: verificationId },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByAdminId: adminId, rejectionReason: reason },
      }),
      this.prisma.user.update({ where: { id: verification.userId }, data: { kycStatus: 'REJECTED' } }),
    ])

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.KYC_REJECTED,
      targetType: 'USER',
      targetId: verification.userId,
      previousState: { status: verification.status },
      newState: { status: 'REJECTED' },
      reason,
    })

    return updated
  }
}
