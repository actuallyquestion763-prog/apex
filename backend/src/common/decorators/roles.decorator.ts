import { SetMetadata } from '@nestjs/common'
import { Role } from '@prisma/client'

export const ROLES_KEY = 'roles'

// Marks a controller/handler as requiring one of the given roles. Enforced
// by RolesGuard, which reads the AUTHENTICATED user from the request (set by
// SessionAuthGuard from a verified session — never from a client-supplied
// header/body field). See common/guards/roles.guard.ts.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
