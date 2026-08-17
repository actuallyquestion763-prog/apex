import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// CMS media (Phase 4, Part 22 items 9-15). CmsMedia is intentionally public
// once uploaded (see cms.service.ts's getMediaFile comment) — "private
// files" in the Part 22 sense means files that were never legitimately
// uploaded at all (path traversal, a nonexistent id), not a draft/publish
// state that doesn't exist for media in this data model.
describe('CMS Media (real PostgreSQL)', () => {
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
    const email = uniqueEmail('mediaadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

  it('9. an admin without cms.media.upload gets 403 uploading media', async () => {
    const { cookie } = await makeAdminWith() // no permissions
    await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', PNG_BYTES, { filename: 'logo.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(403)
  })

  let mediaId: string

  it('10. an admin with cms.media.upload can upload a valid PNG', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    const res = await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', PNG_BYTES, { filename: 'logo.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(201)
    expect(res.body.mimeType).toBe('image/png')
    mediaId = res.body.id
  })

  it('11. an oversized file is rejected', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024 + 1)])
    await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', big, { filename: 'huge.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(400)
  })

  it('12. an unsupported/mismatched file type is rejected — both an outright-disallowed mime type and a mislabeled one', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    // Disallowed outright (also covers SVG, restricted in Phase 4 — Part 10).
    await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), { filename: 'evil.svg', contentType: 'image/svg+xml' })
      .field('kind', 'IMAGE')
      .expect(400)
    // Declared as an allowed type but the bytes don't match it (magic-byte check).
    await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', Buffer.from('#!/bin/sh\necho pwned'), { filename: 'script.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(400)
  })

  it('13. path traversal in the uploaded filename cannot escape the storage directory', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    const res = await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', PNG_BYTES, { filename: '../../../../etc/passwd', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(201)
    const row = await prisma.cmsMedia.findUniqueOrThrow({ where: { id: res.body.id } })
    // storageKey is always a fresh random UUID + allowlisted extension —
    // never derived from the client-supplied filename at all.
    expect(row.storageKey).not.toContain('..')
    expect(row.storageKey).not.toContain('passwd')
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}\.png$/)
  })

  it('14. media referenced by a published page cannot be deleted; deleting an unreferenced one succeeds', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload', 'cms.media.delete', 'cms.pages.create', 'cms.pages.publish')
    const upload = await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', PNG_BYTES, { filename: 'hero.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(201)
    const refMediaId = upload.body.id

    const slug = `media-ref-test-${Date.now()}`
    const page = await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({
      slug, title: 'Media Ref Test',
      sections: [{ type: 'hero', fields: { title: 'x', url: `/cms/media/${refMediaId}` } }],
    }).expect(201)
    await request(server).post(`/admin/cms/pages/${page.body.id}/publish`).set('Cookie', cookie).send({}).expect(201)

    // Referenced by a PUBLISHED page — deletion is blocked, not silently
    // allowed to break the live page.
    await request(server).delete(`/admin/cms/media/${refMediaId}`).set('Cookie', cookie).expect(400)

    // An unreferenced media row deletes cleanly.
    await request(server).delete(`/admin/cms/media/${mediaId}`).set('Cookie', cookie).expect(200)
    expect(await prisma.cmsMedia.findUnique({ where: { id: mediaId } })).toBeNull()
  })

  it('15. the public media endpoint serves an uploaded file by id but 404s for a nonexistent one — no filesystem path is ever exposed', async () => {
    const { cookie } = await makeAdminWith('cms.media.upload')
    const upload = await request(server).post('/admin/cms/media').set('Cookie', cookie)
      .attach('file', PNG_BYTES, { filename: 'public.png', contentType: 'image/png' })
      .field('kind', 'IMAGE')
      .expect(201)

    const served = await request(server).get(`/cms/media/${upload.body.id}`).expect(200)
    expect(served.headers['content-type']).toContain('image/png')

    // A random/guessed id (and any attempted traversal in the id segment)
    // resolves through the database lookup only — never a raw file read —
    // so it 404s exactly like any other nonexistent resource.
    await request(server).get('/cms/media/not-a-real-id').expect(404)
    await request(server).get('/cms/media/00000000-0000-0000-0000-000000000000').expect(404)
  })
})
