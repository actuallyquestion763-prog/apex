import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { toPublicUser } from './public-user'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    return toPublicUser(user)
  }

  async updateProfile(userId: string, patch: { fullName?: string; country?: string }) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: patch })
    return toPublicUser(user)
  }
}
