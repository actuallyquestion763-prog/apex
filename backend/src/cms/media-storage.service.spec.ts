import { Readable } from 'stream'
import { mockClient } from 'aws-sdk-client-mock'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { BadRequestException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common'
import { MediaStorageService } from './media-storage.service'

// Minimal, real-signature-matching byte sequences for every currently
// allowed type — same values file-signature.util.ts actually checks against,
// not arbitrary bytes, so a passing save() test here genuinely exercises the
// magic-byte check rather than bypassing it.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0])
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

const s3 = new S3Client({ region: 'auto' })
const s3Mock = mockClient(s3)

describe('MediaStorageService', () => {
  let service: MediaStorageService

  beforeEach(() => {
    s3Mock.reset()
    process.env.S3_BUCKET = 'test-bucket'
    service = new MediaStorageService(s3)
  })

  // ---- save() — upload validation (unchanged security guarantees) --------

  describe('save', () => {
    it('accepts every currently allowed MIME type and generates a UUID-based object key', async () => {
      s3Mock.on(PutObjectCommand).resolves({})
      const cases: [string, Buffer, string][] = [
        ['image/png', PNG_BYTES, '.png'],
        ['image/jpeg', JPEG_BYTES, '.jpg'],
        ['image/webp', WEBP_BYTES, '.webp'],
        ['image/gif', GIF_BYTES, '.gif'],
        ['application/pdf', PDF_BYTES, '.pdf'],
      ]
      const seenKeys = new Set<string>()
      for (const [mimeType, bytes, ext] of cases) {
        const result = await service.save('upload' + ext, mimeType, bytes)
        expect(result.storageKey).toMatch(/^[0-9a-f-]{36}\.\w+$/)
        expect(result.storageKey.endsWith(ext)).toBe(true)
        expect(result.size).toBe(bytes.length)
        seenKeys.add(result.storageKey)
      }
      expect(seenKeys.size).toBe(cases.length) // every key is unique
    })

    it('never uses the client-supplied filename as the object key', async () => {
      s3Mock.on(PutObjectCommand).resolves({})
      const result = await service.save('../../etc/passwd.png', 'image/png', PNG_BYTES)
      expect(result.storageKey).not.toContain('passwd')
      expect(result.storageKey).not.toContain('..')
      expect(result.storageKey).not.toContain('/')
    })

    it('uploads to the configured bucket with the declared content type', async () => {
      s3Mock.on(PutObjectCommand).resolves({})
      const result = await service.save('a.png', 'image/png', PNG_BYTES)
      const calls = s3Mock.commandCalls(PutObjectCommand)
      expect(calls).toHaveLength(1)
      expect(calls[0].args[0].input.Bucket).toBe('test-bucket')
      expect(calls[0].args[0].input.Key).toBe(result.storageKey)
      expect(calls[0].args[0].input.ContentType).toBe('image/png')
    })

    it('rejects a disallowed MIME type', async () => {
      await expect(service.save('a.svg', 'image/svg+xml', Buffer.from('<svg/>'))).rejects.toThrow(BadRequestException)
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0)
    })

    it('rejects an empty file', async () => {
      await expect(service.save('a.png', 'image/png', Buffer.alloc(0))).rejects.toThrow(BadRequestException)
    })

    it('rejects a file over the 5MB limit', async () => {
      const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024)])
      await expect(service.save('a.png', 'image/png', big)).rejects.toThrow(/5MB limit/)
    })

    it('rejects content whose magic bytes do not match the declared MIME type', async () => {
      // Declares PDF but sends PNG bytes — the exact "renamed script" attack
      // this check exists to close.
      await expect(service.save('a.pdf', 'application/pdf', PNG_BYTES)).rejects.toThrow(/does not match its declared type/)
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0)
    })

    it('never leaks the underlying storage error to the caller on an upload failure', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('AccessDenied: real-bucket-name, real-endpoint.example.com, AKIAREALKEY'))
      await expect(service.save('a.png', 'image/png', PNG_BYTES)).rejects.toThrow(InternalServerErrorException)
      await expect(service.save('a.png', 'image/png', PNG_BYTES)).rejects.not.toThrow(/AKIAREALKEY|real-endpoint/)
    })

    // Step A (Part 33) — the real error must now actually be captured
    // server-side, since AllExceptionsFilter never logs an HttpException
    // (see media-storage.service.ts's summarizeS3Error() comment for why
    // that made the previous bare `catch {}` a dead end for diagnosis).
    it('logs the real S3 error server-side on an upload failure, distinct from AccessDenied/NoSuchBucket/etc.', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const err = new Error('The specified bucket does not exist')
      err.name = 'NoSuchBucket'
      ;(err as unknown as { $metadata: { httpStatusCode: number; requestId: string } }).$metadata = { httpStatusCode: 404, requestId: 'req-123' }
      s3Mock.on(PutObjectCommand).rejects(err)

      await expect(service.save('a.png', 'image/png', PNG_BYTES)).rejects.toThrow(InternalServerErrorException)

      expect(errorSpy).toHaveBeenCalled()
      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain('NoSuchBucket')
      expect(logged).toContain('404')
      expect(logged).toContain('req-123')
      errorSpy.mockRestore()
    })

    it('redacts credential-shaped substrings from the LOGGED error too, not just the client-facing message, while preserving long alphabetic diagnostic codes', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      // AKIAIOSFODNN7EXAMPLE is AWS's own published example access key
      // format (real-shaped, contains a digit) — paired with a
      // SignatureDoesNotMatch, a real AWS error CODE that is itself 21
      // unbroken alphabetic characters (no digits), specifically to prove
      // the redaction distinguishes "credential-shaped" from "a long
      // English error-code word" rather than blindly redacting anything
      // over 20 characters.
      s3Mock.on(PutObjectCommand).rejects(new Error('SignatureDoesNotMatch using access key AKIAIOSFODNN7EXAMPLE and secret th1sIsASecretLookingToken1234567890'))

      await expect(service.save('a.png', 'image/png', PNG_BYTES)).rejects.toThrow(InternalServerErrorException)

      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(logged).not.toContain('th1sIsASecretLookingToken1234567890')
      expect(logged).toContain('[REDACTED]')
      expect(logged).toContain('SignatureDoesNotMatch') // the useful diagnostic code survives, unredacted
      errorSpy.mockRestore()
    })

    it('never logs the uploaded file bytes on a failure', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      s3Mock.on(PutObjectCommand).rejects(new Error('some transient failure'))

      await expect(service.save('a.png', 'image/png', PNG_BYTES)).rejects.toThrow(InternalServerErrorException)

      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).not.toContain(PNG_BYTES.toString('base64'))
      expect(logged).not.toContain(PNG_BYTES.toString('binary'))
      errorSpy.mockRestore()
    })
  })

  // ---- getObjectStream() — read (replaces pathFor()) ----------------------

  describe('getObjectStream', () => {
    it('returns a readable stream of the object bytes for a valid key', async () => {
      const body = Readable.from([Buffer.from('hello world')])
      s3Mock.on(GetObjectCommand).resolves({ Body: body as never })
      const stream = await service.getObjectStream('11111111-1111-1111-1111-111111111111.png')
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      expect(Buffer.concat(chunks).toString()).toBe('hello world')
    })

    it('throws NotFoundException (never a raw S3 error) for a missing object', async () => {
      const err = new Error('The specified key does not exist.')
      err.name = 'NoSuchKey'
      s3Mock.on(GetObjectCommand).rejects(err)
      await expect(service.getObjectStream('22222222-2222-2222-2222-222222222222.png')).rejects.toThrow(NotFoundException)
    })

    it('rejects a storageKey that does not look server-generated, without ever calling S3', async () => {
      await expect(service.getObjectStream('../../etc/passwd')).rejects.toThrow(NotFoundException)
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0)
    })

    it('never leaks the underlying storage error (bucket/endpoint/credentials) on an unexpected failure', async () => {
      s3Mock.on(GetObjectCommand).rejects(new Error('connect ECONNREFUSED real-endpoint.example.com:443'))
      await expect(service.getObjectStream('33333333-3333-3333-3333-333333333333.png')).rejects.toThrow(InternalServerErrorException)
      await expect(service.getObjectStream('33333333-3333-3333-3333-333333333333.png')).rejects.not.toThrow(/real-endpoint/)
    })
  })

  // ---- delete() -------------------------------------------------------------

  describe('delete', () => {
    it('deletes the object at the given key from the configured bucket', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({})
      await service.delete('44444444-4444-4444-4444-444444444444.png')
      const calls = s3Mock.commandCalls(DeleteObjectCommand)
      expect(calls).toHaveLength(1)
      expect(calls[0].args[0].input.Bucket).toBe('test-bucket')
      expect(calls[0].args[0].input.Key).toBe('44444444-4444-4444-4444-444444444444.png')
    })

    it('is a silent no-op for a key that does not look server-generated (never calls S3)', async () => {
      await service.delete('../../etc/passwd')
      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    })

    it('does not throw if the underlying delete fails (best-effort cleanup, matching the previous local-disk behavior)', async () => {
      s3Mock.on(DeleteObjectCommand).rejects(new Error('object already gone'))
      await expect(service.delete('55555555-5555-5555-5555-555555555555.png')).resolves.toBeUndefined()
    })
  })

  // ---- Private/public storage semantics --------------------------------
  // MediaStorageService deliberately has no public/private concept of its
  // own — every object lives in the same private bucket regardless of
  // upload category. "Public" (CMS media) vs "private" (KYC/deposit/
  // support) is enforced entirely by each service's own authorization check
  // BEFORE it ever calls getObjectStream() — see kyc.service.ts,
  // deposits.service.ts, support.service.ts (ownership/permission checks)
  // vs cms.service.ts (deliberately none). This is exercised by each of
  // those services' own tests and by test/media-storage.e2e-spec.ts, not
  // here — there is nothing for a bucket-agnostic class to test on this
  // axis beyond confirming (above) that it has no separate "make public"
  // method or bucket-ACL toggle a caller could reach for by mistake.
  it('exposes no public/bucket-ACL toggle — access control is entirely the caller\'s responsibility', () => {
    expect((service as unknown as Record<string, unknown>).makePublic).toBeUndefined()
    expect((service as unknown as Record<string, unknown>).setAcl).toBeUndefined()
  })
})
