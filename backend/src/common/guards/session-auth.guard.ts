import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { hashToken } from '../../auth/token.util'
import { SESSION_COOKIE_NAME } from '../../auth/auth.constants'
import type { AuthenticatedUser } from '../types/authenticated-user'

// The ONLY place in the backend that decides "who is this request from."
// Trusts nothing from the client except the opaque session cookie value,
// looks up its hash against the Session table, and rejects anything
// missing/expired/revoked. Every other guard/service downstream relies on
// this having already run.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token: string | undefined = request.cookies?.[SESSION_COOKIE_NAME]
    if (!token) throw new UnauthorizedException('Not authenticated.')

    const tokenHash = hashToken(token)
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is invalid or expired.')
    }
    if (session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active.')
    }

    const authedUser: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      status: session.user.status,
      sessionId: session.id,
    }
    request.user = authedUser
    return true
  }
}
