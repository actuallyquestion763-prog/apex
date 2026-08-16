import { IsIn, IsNumberString, IsString } from 'class-validator'

export class CreateOrderDto {
  @IsString()
  symbol!: string

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL'

  // String, not number — avoids the caller ever needing to round-trip a
  // monetary/quantity value through JS floating point on the way in.
  @IsNumberString()
  quantity!: string
}
