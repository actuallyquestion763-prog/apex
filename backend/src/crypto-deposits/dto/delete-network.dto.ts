import { IsString, MinLength } from 'class-validator'

// Same step-up tier as UpsertCryptoDepositAddressDto — removing a receiving
// address configuration is exactly as fund-safety-relevant as changing one.
export class DeleteNetworkDto {
  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
