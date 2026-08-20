import { IsIn, IsString, MinLength } from 'class-validator'
import { AccountStatus } from '@prisma/client'

// Phase 6F Checkpoint F, Part 14/15 — distinct from UpdateUserStatusDto:
// Account.status (checked by RiskEngineService's ACCOUNT_TRADING_DISABLED
// check) is a separate field from User.status (checked at the session-auth
// guard layer, before any request reaches a controller at all). A user
// with multiple accounts in the future could have one restricted without
// suspending the user's login/session entirely — see prisma/schema.prisma's
// Account model comment.
export class UpdateAccountStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'RESTRICTED', 'PENDING_VERIFICATION', 'CLOSED'])
  status!: AccountStatus

  @IsString()
  @MinLength(3)
  reason!: string
}
