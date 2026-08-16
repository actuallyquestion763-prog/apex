import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@prisma/client'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { AuthenticatedUser } from '../types/authenticated-user'

// Must run after SessionAuthGuard (which populates request.user). Rejects
// unless request.user.role is one of the roles the handler requires.
// SUPER_ADMIN does not implicitly satisfy an ADMIN-only route or vice versa —
// each handler declares exactly which roles it accepts via @Roles(...).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles || requiredRoles.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user: AuthenticatedUser | undefined = request.user
    if (!user) throw new ForbiddenException('Not authenticated.')
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to perform this action.')
    }
    return true
  }
}
