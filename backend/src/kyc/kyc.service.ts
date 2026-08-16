import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'

// Status tracking only — no identity-verification provider is connected.
// submit() intentionally does not accept or store any document data (the
// old frontend stored base64 ID photos directly in localStorage; this
// foundation does not repeat that). A real integration would receive a
// provider webhook/callback and call approve()/reject() from that handler
// instead of an admin clicking a button — see backend/README.md.
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(userId: string, providerReference?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.kycStatus === 'PENDING') throw new BadRequestException('A verification is already pending.')
    if (user.kycStatus === 'VERIFIED') throw new BadRequestException('This account is already verified.')

    const [verification] = await this.prisma.$transaction([
      this.prisma.kycVerification.create({ data: { userId, status: 'PENDING', providerReference } }),
      this.prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } }),
    ])

    await this.audit.record({ actorId: userId, action: AuditEvent.KYC_SUBMITTED, targetType: 'USER', targetId: userId })
    return verification
  }

  async listPending() {
    return this.prisma.kycVerification.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    })
  }

  async approve(verificationId: string, adminId: string) {
    const verification = await this.prisma.kycVerification.findUnique({ where: { id: verificationId } })
    if (!verification) throw new NotFoundException('Verification not found.')
    if (verification.status === 'VERIFIED') return verification // idempotent no-op

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
