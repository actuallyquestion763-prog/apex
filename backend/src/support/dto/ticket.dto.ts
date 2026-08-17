import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export class CreateTicketDto {
  @IsUUID()
  categoryId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string

  // The customer's requested priority — informational only, never trusted
  // as the authoritative internal priority. See SupportTicket.requestedPriority.
  @IsOptional()
  @IsIn(PRIORITIES)
  requestedPriority?: (typeof PRIORITIES)[number]
}

export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string

  // Only meaningful for staff — ignored/forced to PUBLIC for a customer
  // caller, enforced server-side in SupportService, never trusted from the
  // request alone.
  @IsOptional()
  @IsIn(['PUBLIC', 'INTERNAL'])
  visibility?: 'PUBLIC' | 'INTERNAL'
}

export class UpdateStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'])
  status!: string

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}

export class UpdatePriorityDto {
  @IsIn(PRIORITIES)
  priority!: (typeof PRIORITIES)[number]

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}

export class AssignTicketDto {
  @IsUUID()
  agentId!: string

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}

// Multipart upload (Phase 4, Part 15) — the file itself is handled by
// FileInterceptor, this only validates the accompanying text field. When
// omitted, SupportService fills in a default body from the filename so the
// message the attachment lives on is never empty.
export class AttachmentBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string

  @IsOptional()
  @IsIn(['PUBLIC', 'INTERNAL'])
  visibility?: 'PUBLIC' | 'INTERNAL'
}

export class MarkNotificationsReadDto {
  @IsOptional()
  @IsUUID('4', { each: true })
  ids?: string[]
}
