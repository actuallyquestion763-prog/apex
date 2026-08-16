import type { User } from '@prisma/client'

// Never return passwordHash (or any future secret field) to a client.
// Every controller that returns a User MUST go through this.
export function toPublicUser(user: User) {
  const { passwordHash: _passwordHash, ...publicFields } = user
  return publicFields
}
