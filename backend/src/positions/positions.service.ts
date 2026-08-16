import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

// Read-only in this phase. Positions are only ever meant to be created from
// a real Fill (see prisma/schema.prisma Position.orderId), and no broker is
// connected yet to produce one — so there is intentionally no
// "open position" write path here. Wiring that up is Phase 6 work
// (broker/exchange execution) from the original audit's phase plan.
@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listOpenForUser(userId: string) {
    return this.prisma.position.findMany({ where: { userId, status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
  }

  async listAllForUser(userId: string) {
    return this.prisma.position.findMany({ where: { userId }, orderBy: { openedAt: 'desc' }, take: 100 })
  }
}
