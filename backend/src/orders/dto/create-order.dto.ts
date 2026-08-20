import { IsIn, IsNumberString, IsOptional, IsString, ValidateIf } from 'class-validator'

export class CreateOrderDto {
  @IsString()
  symbol!: string

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL'

  // String, not number — avoids the caller ever needing to round-trip a
  // monetary/quantity value through JS floating point on the way in.
  @IsNumberString()
  quantity!: string

  // Phase 6F Checkpoint D — defaults to MARKET (the entire existing
  // behavior, unchanged) when omitted, so every pre-existing caller keeps
  // working without modification.
  @IsOptional()
  @IsIn(['MARKET', 'LIMIT'])
  orderType?: 'MARKET' | 'LIMIT'

  // Required for LIMIT, forbidden/ignored for MARKET (real exchanges don't
  // accept a price on a MARKET order — see execution-provider.types.ts).
  @ValidateIf((o) => o.orderType === 'LIMIT')
  @IsNumberString()
  limitPrice?: string
}
