import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { Readable } from 'stream'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { matchesFileSignature } from './file-signature.util'
import { S3_CLIENT } from './media-storage.tokens'

// A credential/secret is never a legitimate part of an S3 SDK error's own
// name/message/metadata (those are protocol-level: error codes, HTTP
// status, request ids) — this is a defense-in-depth scrub, not the primary
// safeguard, in case a provider ever echoes a caller-supplied value (e.g.
// an access key id) back into a message. Matches long token-shaped
// substrings generically rather than one provider's exact key format, so
// it isn't tied to AWS's specific AKIA... prefix — but ONLY redacts a match
// that contains a digit (see the replacer below), since a real access
// key/secret is virtually always alphanumeric while AWS's own long
// English error-code words (e.g. "SignatureDoesNotMatch", 21 characters,
// no digits) are not — without that distinction this would redact the
// diagnostic codes it exists to preserve.
const CREDENTIAL_LIKE = /[A-Za-z0-9/+_-]{20,}/g

// Extracts only protocol-level diagnostic fields from an S3 SDK error —
// never the request body, file buffer, or any KYC/user field, none of
// which this function ever receives in the first place (it only ever sees
// the `err` thrown by an S3Client command, which structurally cannot
// contain them). Used for server-side logging ONLY; the client always gets
// the same fixed, generic message regardless of what this returns.
function summarizeS3Error(err: unknown): Record<string, unknown> {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number; requestId?: string }; Code?: string } | null
  const rawMessage = e?.message ?? String(err)
  return {
    name: e?.name ?? 'UnknownError',
    code: e?.Code,
    httpStatusCode: e?.$metadata?.httpStatusCode,
    requestId: e?.$metadata?.requestId,
    message: rawMessage.replace(CREDENTIAL_LIKE, (match) => (/\d/.test(match) ? '[REDACTED]' : match)),
  }
}

// Production storage backend: an S3-compatible bucket (Cloudflare R2 in
// production; any S3-compatible endpoint works, since every provider-facing
// detail lives in s3-client.factory.ts / environment variables, never here —
// see that file's comment). Deliberately the same small, swappable
// interface it always was — nothing outside this class knows or cares
// whether bytes live on local disk or in a bucket, it only ever sees a
// storageKey. This used to be local-disk I/O (backend/uploads/); the
// interface is now async throughout because a real object-storage call
// always is, but the shape callers see is otherwise unchanged.
//
// Shared by CmsMedia, SupportAttachment, Deposit-proof, and KycDocument
// uploads — same allowlist, same size limit, same magic-byte check, same
// random-storage-key scheme, same single storage abstraction, exactly as
// before.
const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
])
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

// storageKey is always server-generated (see save() below) as a UUID plus a
// fixed, known extension — never derived from client input. This pattern is
// the defense-in-depth check that a value about to be used as an S3 object
// key actually looks like one of ours, mirroring the old safeBasename()
// guard that stripped directory components before touching the filesystem.
// An S3 key that doesn't match this can never have been produced by save(),
// so refusing it here costs nothing and closes off any path where a
// corrupted/tampered storageKey could be used to address an unintended
// object.
const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|pdf)$/

export interface StoredFile {
  storageKey: string
  size: number
}

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger('MediaStorageService')

  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  private get bucket(): string {
    const bucket = process.env.S3_BUCKET
    if (!bucket) throw new InternalServerErrorException('Object storage is not configured.')
    return bucket
  }

  // Validates the CLIENT-DECLARED mimeType against an allowlist AND the
  // actual leading bytes of the file against that same mimeType's real
  // signature — a caller can no longer upload an arbitrary file mislabeled
  // as an allowed image/PDF type. Never trusts the filename extension for
  // anything (storageKey is a fresh random name, the original filename is
  // stored only as display metadata) — all unchanged from before.
  async save(originalFilename: string, mimeType: string, buffer: Buffer): Promise<StoredFile> {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(`File type "${mimeType}" is not allowed.`)
    }
    if (buffer.length === 0) throw new BadRequestException('File is empty.')
    if (buffer.length > MAX_BYTES) throw new BadRequestException(`File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit.`)
    if (!matchesFileSignature(mimeType, buffer)) {
      throw new BadRequestException('File content does not match its declared type.')
    }

    // Random name, not the client-supplied filename — prevents path
    // traversal / key-injection and never executes based on extension since
    // nothing interprets the name; this object key is opaque.
    const safeExt = extensionFor(mimeType)
    const storageKey = `${randomUUID()}${safeExt}`

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }))
    } catch (err) {
      // Server-side ONLY (never in the client response, see below): the
      // real S3/R2 error — name/error-code/HTTP-status/requestId, plus a
      // credential-scrubbed message — so a failure like a bad bucket,
      // wrong credentials, or a region/endpoint mismatch is actually
      // diagnosable from Render's log stream. storageKey/mimeType are
      // server-generated/client-declared metadata, never file bytes or any
      // KYC field. See summarizeS3Error()'s own comment for exactly what
      // this can and cannot contain.
      this.logger.error(`PutObject failed for storageKey=${storageKey} mimeType=${mimeType}: ${JSON.stringify(summarizeS3Error(err))}`)
      // Never surface the underlying SDK error (which can include the
      // endpoint/bucket) to a client — a clean, generic failure here still
      // lets the caller know the upload didn't happen.
      throw new InternalServerErrorException('Could not store the uploaded file.')
    }

    return { storageKey, size: buffer.length }
  }

  async delete(storageKey: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) return
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }))
    } catch {
      // Matches the previous local-disk behavior (existsSync guard — a
      // missing file was never an error there either): deletion is
      // best-effort cleanup, not a step whose failure should block the
      // caller's own operation (e.g. replacing a deposit proof).
    }
  }

  // Replaces pathFor()'s filesystem-path assumption. Returns a live
  // Readable the caller pipes straight into a StreamableFile, exactly as
  // they previously did with createReadStream(path) — the read side of the
  // interface is otherwise unchanged in shape.
  async getObjectStream(storageKey: string): Promise<Readable> {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new NotFoundException('File not found.')
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }))
      // In the Node.js runtime (this backend), GetObjectCommand's Body is
      // always a Node Readable — the wider SdkStream/Blob/WebReadableStream
      // union in the SDK's own types only applies to browser/edge runtimes.
      return res.Body as Readable
    } catch (err) {
      if (isNotFoundError(err)) throw new NotFoundException('File not found.')
      throw new InternalServerErrorException('Could not retrieve the requested file.')
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'NoSuchKey' || name === 'NotFound'
}

// Only a fixed, known allowlist of extensions is ever produced — never
// derived from client input — so a stored object can never end in something
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
