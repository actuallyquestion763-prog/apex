import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { hashToken } from '../../auth/token.util'
import { SESSION_COOKIE_NAME } from '../../auth/auth.constants'
import type { AuthenticatedUser } from '../types/authenticated-user'

// Same validation as SessionAuthGuard, but never rejects the request — it
// populates request.user when a valid session cookie is present and simply
// leaves it undefined otherwise. For public content endpoints (CMS pages,
// announcements) whose response legitimately differs for a logged-in
// visitor vs an anonymous one, but where anonymous access must still be
// allowed. Never use this where the route needs to KNOW who the caller is
// for an authorization decision — that's what SessionAuthGuard is for.
@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token: string | undefined = request.cookies?.[SESSION_COOKIE_NAME]
    if (!token) return true

    const tokenHash = hashToken(token)
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      return true // invalid/expired session -> treat exactly like an anonymous visitor, don't reject
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
