import { BadRequestException, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { matchesFileSignature } from './file-signature.util'

// Development storage backend: local disk, under backend/uploads/ (gitignored,
// never PostgreSQL — see CmsMedia's schema comment for why). Deliberately a
// small, swappable interface — a production deployment replaces only this
// one file with an S3-compatible implementation; nothing else in the CMS
// module knows or cares where bytes physically live, it only ever sees a
// storageKey. No external storage provider is wired up in this phase.
//
// Shared by BOTH CmsMedia uploads and SupportAttachment uploads (Phase 4,
// Part 15) — same allowlist, same size limit, same magic-byte check, same
// random-storage-key scheme. There is deliberately one storage abstraction,
// not two bespoke ones.
const UPLOAD_ROOT = join(__dirname, '..', '..', 'uploads')

// image/svg+xml was removed in Phase 4 (Part 10): SVG is XML that can carry
// active content (<script>, event handlers, foreignObject), and there is no
// vetted SVG sanitizer in this project to safely neutralize that — the spec
// explicitly allows restricting SVG until a proper sanitizer exists rather
// than half-sanitizing it, which is what this does.
const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
])
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

export interface StoredFile {
  storageKey: string
  size: number
}

@Injectable()
export class MediaStorageService {
  // Validates the CLIENT-DECLARED mimeType against an allowlist AND (Phase 4
  // hardening) the actual leading bytes of the file against that same
  // mimeType's real signature — a caller can no longer upload an arbitrary
  // file mislabeled as an allowed image/PDF type. Never trusts the filename
  // extension for anything (storageKey is a fresh random name, the original
  // filename is stored only as display metadata).
  save(originalFilename: string, mimeType: string, buffer: Buffer): StoredFile {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(`File type "${mimeType}" is not allowed.`)
    }
    if (buffer.length === 0) throw new BadRequestException('File is empty.')
    if (buffer.length > MAX_BYTES) throw new BadRequestException(`File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit.`)
    if (!matchesFileSignature(mimeType, buffer)) {
      throw new BadRequestException('File content does not match its declared type.')
    }

    if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true })

    // Random name, not the client-supplied filename — prevents path
    // traversal (e.g. "../../etc/passwd") and never executes based on
    // extension since nothing in this service interprets the name.
    const safeExt = extensionFor(mimeType)
    const storageKey = `${randomUUID()}${safeExt}`
    writeFileSync(join(UPLOAD_ROOT, storageKey), buffer)

    return { storageKey, size: buffer.length }
  }

  delete(storageKey: string): void {
    const path = join(UPLOAD_ROOT, safeBasename(storageKey))
    if (existsSync(path)) unlinkSync(path)
  }

  pathFor(storageKey: string): string {
    return join(UPLOAD_ROOT, safeBasename(storageKey))
  }
}

// Only a fixed, known allowlist of extensions is ever produced — never
// derived from client input — so a stored file can never end in something
// like ".php" or ".exe" no matter what a caller claims its mimeType is.
function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
  }
  return map[mimeType] ?? ''
}

// Defense in depth against path traversal even though storageKey is always
// server-generated: strip any directory components before touching the
// filesystem.
function safeBasename(storageKey: string): string {
  return storageKey.replace(/^.*[\\/]/, '')
}
