import { IsNumberString, IsOptional, IsString, ValidateIf } from 'class-validator'

export class CreateDepositDto {
  @IsNumberString()
  amount!: string

  // Checkpoint K — INTERNAL_TRANSFER preserves every pre-existing method
  // value this DTO already accepted (a plain free-text label, e.g. "Bank
  // Transfer"/"Credit / Debit Card" — see DepositPage.tsx); CRYPTO is new
  // and additionally requires cryptoAssetSymbol/networkCode below. Neither
  // existing callers nor existing tests are affected — `method` was never
  // constrained to a fixed set before this change.
  @IsString()
  method!: string

  @IsOptional()
  @IsString()
  currency?: string

  // Required only when method === 'CRYPTO' — the frontend sends the
  // user-selected asset/network, but this is NEVER trusted at face value:
  // DepositsService re-resolves it against CryptoDepositsService and
  // rejects anything not currently configured+enabled (Part 5/6's "backend
  // must validate the selected crypto is actually supported").
  @ValidateIf((o) => o.method === 'CRYPTO')
  @IsString()
  cryptoAssetSymbol?: string

  @ValidateIf((o) => o.method === 'CRYPTO')
  @IsString()
  networkCode?: string
}
