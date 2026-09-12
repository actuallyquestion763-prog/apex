import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

// Creates a brand-new administrator account directly — distinct from the
// existing "promote a self-registered USER to ADMIN via PATCH
// .../role" path (admin.service.ts's updateUserRole), which remains the
// only way to reach SUPER_ADMIN. This endpoint only ever creates ADMIN
// (never SUPER_ADMIN) accounts — see AdminService.createAdmin.
export class CreateAdminDto {
  @IsEmail()
  email!: string

  @IsOptional()
  @IsString()
  fullName?: string

  @IsString()
  @MinLength(12)
  password!: string

  @IsString()
  @MinLength(5)
  reason!: string

  @IsString()
  confirmPassword!: string
}
