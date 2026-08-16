import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

export interface AuditEventInput {
  actorId?: string | null
  action: string
  targetType?: string
  targetId?: string
  ipAddress?: string
  userAgent?: string
  previousState?: Prisma.InputJsonValue
  newState?: Prisma.InputJsonValue
  reason?: string
  metadata?: Prisma.InputJsonValue
}

// Append-only by convention: this service exposes record() and read methods
// only — nothing here updates or deletes an AuditLog row, and no other
// module should import PrismaService.auditLog directly.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma
    return client.auditLog.create({
      data: {
        actorId: event.actorId ?? null,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        previousState: event.previousState,
        newState: event.newState,
        reason: event.reason,
        metadata: event.metadata,
      },
    })
  }

  async listRecent(limit = 100) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    })
  }

  async listForTarget(targetType: string, targetId: string) {
    return this.prisma.auditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
