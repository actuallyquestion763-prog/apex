import { Role, AccountStatus } from '@prisma/client'

// The shape SessionAuthGuard attaches to `request.user` after validating the
// session cookie against the Session table. This is the ONLY source of truth
// for "who is making this request" anywhere in the backend.
export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
  status: AccountStatus
  sessionId: string
}
