import { IsIn, IsNumberString } from 'class-validator'
import { CONVERTIBLE_CURRENCIES } from '../convert-currencies'

export class ConvertDto {
  @IsIn(CONVERTIBLE_CURRENCIES)
  fromCurrency!: string

  @IsIn(CONVERTIBLE_CURRENCIES)
  toCurrency!: string

  // String, not number — same convention as every other monetary DTO field
  // in this codebase (never round-trip a monetary value through JS
  // floating point on the way in).
  @IsNumberString()
  amount!: string
}
