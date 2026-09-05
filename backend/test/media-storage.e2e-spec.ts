import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// P1-A: covers what the existing per-category e2e specs (kyc.e2e-spec.ts,
// crypto-deposits.e2e-spec.ts's proof tests, support.e2e-spec.ts,
// media.e2e-spec.ts) don't already exercise for the S3-compatible storage
// swap — those specs already prove real upload -> DB reference -> authorized
// retrieval (and cross-user/permission denial) for every category, and
// re-running unchanged against the real local S3-compatible test server
// (scripts/test-s3.js) is itself the regression proof that the swap didn't
// change behavior. This file adds: byte-for-byte fidelity across every
// allowed MIME type, unauthenticated (no session at all) access denial, and
// confirmation that a storage-layer failure never leaks credentials/
// endpoint/bucket details into an HTTP response.
describe('Object storage (S3-compatible, real local test server)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  async function loginAs(email: string, password: string) {
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return extractSessionCookie(res)
  }

  async function makeAdminWith(...permissions: string[]) {
    const email = uniqueEmail('storageadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  // Real, signature-matching bytes for every currently allowed type — same
  // values file-signature.util.ts actually checks, so a round trip here
  // genuinely exercises upload -> S3 PutObject -> S3 GetObject -> compare,
  // not a shortcut around the magic-byte validation.
  const FIXTURES: { mimeType: string; ext: string; bytes: Buffer }[] = [
    { mimeType: 'image/png', ext: 'png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]) },
    { mimeType: 'image/jpeg', ext: 'jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 6, 7, 8, 9, 10]) },
    { mimeType: 'image/webp', ext: 'webp', bytes: Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 11, 12]) },
    { mimeType: 'image/gif', ext: 'gif', bytes: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 13, 14]) },
    { mimeType: 'application/pdf', ext: 'pdf', bytes: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 15, 16, 17]) },
  ]

  for (const { mimeType, ext, bytes } of FIXTURES) {
    it(`round-trips ${mimeType} byte-for-byte: upload -> store -> retrieve -> compare`, async () => {
      const { cookie } = await makeAdminWith('cms.media.upload')
      const upload = await request(server).post('/admin/cms/media').set('Cookie', cookie)
        .attach('file', bytes, { filename: `fixture.${ext}`, contentType: mimeType })
        .field('kind', 'IMAGE')
        .expect(201)

      const retrieved = await request(server).get(`/cms/media/${upload.body.id}`).responseType('blob').expect(200)
      expect(retrieved.headers['content-type']).toContain(mimeType)
      expect(Buffer.compare(Buffer.from(retrieved.body), bytes)).toBe(0)
    })
  }

  it('an entirely unauthenticated request (no session cookie at all) is denied for every private read endpoint', async () => {
    // KYC document, deposit proof, and support attachment endpoints all
    // require SessionAuthGuard at the controller level — confirming this
    // holds for the new S3-backed read path, not just conceptually.
    await request(server).get('/kyc/documents/00000000-0000-0000-0000-000000000000').expect(401)
    await request(server).get('/deposits/00000000-0000-0000-0000-000000000000/proof').expect(401)
    await request(server).get('/support/attachments/00000000-0000-0000-0000-000000000000').expect(401)
  })

  it('CMS media remains publicly retrievable without any session at all — the one deliberately public category', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    const upload = await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', FIXTURES[0].bytes, { filename: 'public.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(201)

    // No .set('Cookie', ...) at all.
    const res = await request(server).get(`/cms/media/${upload.body.id}`).expect(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  it('a storage-layer failure (missing object) never leaks the bucket, endpoint, or credentials into the HTTP response', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    // A CmsMedia row whose storageKey was never actually written to the
    // bucket — the DB lookup succeeds, the S3 GetObject fails, and the
    // response must still be the app's own clean 404, not a raw AWS SDK
    // error serialized into JSON.
    const row = await prisma.cmsMedia.create({
      data: {
        filename: 'orphaned.png',
        mimeType: 'image/png',
        size: 12,
        storageKey: '99999999-9999-9999-9999-999999999999.png',
        kind: 'IMAGE',
        uploadedByAdminId: (await createUserDirect(prisma, { email: uniqueEmail('orphanowner'), password: 'x', role: 'ADMIN' })).user.id,
      },
    })

    const res = await request(server).get(`/cms/media/${row.id}`)
    expect(res.status).toBe(404)
    const body = JSON.stringify(res.body)
    expect(body).not.toMatch(/S3RVER/i)
    expect(body).not.toMatch(/localhost:5434/)
    expect(body).not.toMatch(/trust-test-uploads/)
    expect(body).not.toMatch(/AccessKeyId|SecretAccessKey/i)
  })
})
