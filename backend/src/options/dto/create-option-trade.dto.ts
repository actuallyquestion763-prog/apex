import { IsIn, IsNumberString, IsOptional, IsString, IsInt, Min } from 'class-validator'

export class CreateOptionTradeDto {
  @IsString()
  symbol!: string

  @IsIn(['BUY', 'SELL'])
  direction!: 'BUY' | 'SELL'

  // String, not number — same convention as CreateOrderDto (never round-trip
  // a monetary value through JS floating point on the way in).
  @IsNumberString()
  investment!: string

  @IsInt()
  @Min(1)
  durationSeconds!: number

  // Demo/test-only result forcing (Part 26) — defaults to NORMAL for every
  // real caller. Rejected outright by the backend outside development/test,
  // regardless of what a caller sends — see options.service.ts.
  @IsOptional()
  @IsIn(['NORMAL', 'FORCE_WIN', 'FORCE_LOSS', 'FORCE_DRAW'])
  requestedResultMode?: 'NORMAL' | 'FORCE_WIN' | 'FORCE_LOSS' | 'FORCE_DRAW'
}
