import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

export class FinancialAdjustmentDto {
  @IsUUID()
  userId!: string

  @IsNumberString()
  amount!: string

  @IsIn(['CREDIT', 'DEBIT'])
  direction!: 'CREDIT' | 'DEBIT'

  // Defaults to 'USD' when omitted (existing behavior, unchanged, for
  // backward compatibility with existing callers) — the Admin Panel
  // redesign's Manual Wallet Adjustment page passes 'USDT' explicitly,
  // matching this platform's USDT-primary product direction.
  @IsOptional()
  @IsString()
  currency?: string

  @IsString()
  @MinLength(5)
  reason!: string

  // Step-up re-authentication: the acting admin must present their own
  // current password AND a fresh TOTP code for this specific privileged
  // action, not just rely on an already-open session. See StepUpService.
  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string

  // Supplied by the admin UI, reused across a single confirm click so a
  // duplicate submit resolves to the same ledger transaction instead of
  // adjusting twice. See LedgerService idempotency handling.
  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
