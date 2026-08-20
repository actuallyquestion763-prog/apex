import { IsBoolean, IsNumberString, IsOptional, IsString, MinLength } from 'class-validator'

export class UpdateMarketConfigDto {
  @IsOptional()
  @IsBoolean()
  tradingEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean

  // Phase 6F Checkpoint F, Part 6/15 — admin control surface for the
  // pre-trade risk engine's per-market limits. String, not number, for the
  // same reason CreateOrderDto's quantity is (Decimal precision, never a
  // JS-float round trip). Omitting a field leaves that limit untouched;
  // sending an empty-string-to-null clearing mechanism isn't needed yet —
  // these are set/updated, not cleared, in every currently-defined flow.
  @IsOptional()
  @IsNumberString()
  minimumQuantity?: string

  @IsOptional()
  @IsNumberString()
  maximumQuantity?: string

  @IsOptional()
  @IsNumberString()
  maxOrderNotional?: string

  @IsOptional()
  @IsNumberString()
  maxPositionQuantity?: string

  @IsString()
  @MinLength(3)
  reason!: string
}
