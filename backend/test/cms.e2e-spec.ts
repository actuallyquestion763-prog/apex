import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('CMS (real PostgreSQL)', () => {
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
    const email = uniqueEmail('cmsadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  const validSections = [{ type: 'hero', fields: { title: 'Welcome', subtitle: 'Trade with confidence', ctaLabel: 'Get started', ctaHref: '/signup' } }]

  // ---- 1 & 2: authorization ----

  it('1. a plain USER cannot access any /admin/cms endpoint', async () => {
    const email = uniqueEmail('cmsuser')
    const password = 'correct-horse-battery'
    await createUserDirect(prisma, { email, password, role: 'USER' })
    const cookie = await loginAs(email, password)
    await request(server).get('/admin/cms/pages').set('Cookie', cookie).expect(403)
  })

  it('2. an ADMIN with no CMS permission granted gets 403 on a CMS admin route', async () => {
    const { cookie } = await makeAdminWith() // no permissions
    await request(server).get('/admin/cms/pages').set('Cookie', cookie).expect(403)
  })

  // ---- 3 & 4: draft creation, not publicly visible ----

  let pageId: string
  const slug = `test-page-${Date.now()}`

  it('3. an admin with cms.pages.create can create a draft page', async () => {
    const { cookie } = await makeAdminWith('cms.pages.create')
    const res = await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({ slug, title: 'Test Page', sections: validSections }).expect(201)
    expect(res.body.status).toBe('DRAFT')
    pageId = res.body.id
  })

  it('4. a draft page is not publicly visible', async () => {
    await request(server).get(`/cms/pages/${slug}`).expect(404)
  })

  // ---- 5, 6, 7: publish authorization + visibility ----

  it('7. an admin WITHOUT cms.pages.publish cannot publish (only cms.pages.update)', async () => {
    const { cookie } = await makeAdminWith('cms.pages.update')
    await request(server).post(`/admin/cms/pages/${pageId}/publish`).set('Cookie', cookie).send({}).expect(403)
  })

  it('5. an admin WITH cms.pages.publish can publish', async () => {
    const { cookie } = await makeAdminWith('cms.pages.publish')
    const res = await request(server).post(`/admin/cms/pages/${pageId}/publish`).set('Cookie', cookie).send({ reason: 'go live' }).expect(201)
    expect(res.body.status).toBe('PUBLISHED')
  })

  it('6. published content becomes publicly visible', async () => {
    const res = await request(server).get(`/cms/pages/${slug}`).expect(200)
    expect(res.body.title).toBe('Test Page')
    expect(res.body.status).toBe('PUBLISHED')
  })

  // ---- 8: archived not visible ----

  it('8. archived content is not publicly visible', async () => {
    const { cookie } = await makeAdminWith('cms.pages.archive')
    await request(server).post(`/admin/cms/pages/${pageId}/archive`).set('Cookie', cookie).send({ reason: 'retiring this page' }).expect(201)
    await request(server).get(`/cms/pages/${slug}`).expect(404)
  })

  // ---- 9: revisions preserve previous versions ----

  it('9. updating a page preserves the previous version as a CmsRevision', async () => {
    const { cookie } = await makeAdminWith('cms.pages.create', 'cms.pages.update', 'cms.pages.read')
    const createRes = await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({ slug: `revtest-${Date.now()}`, title: 'Original Title', sections: validSections }).expect(201)
    const id = createRes.body.id

    await request(server).patch(`/admin/cms/pages/${id}`).set('Cookie', cookie).send({ title: 'Updated Title', reason: 'rewording' }).expect(200)

    const revisions = await request(server).get(`/admin/cms/pages/${id}/revisions`).set('Cookie', cookie).expect(200)
    expect(revisions.body).toHaveLength(1)
    expect(revisions.body[0].snapshot.title).toBe('Original Title') // the snapshot is what it was BEFORE the update

    const current = await request(server).get(`/admin/cms/pages/${id}`).set('Cookie', cookie).expect(200)
    expect(current.body.title).toBe('Updated Title')
  })

  // ---- 10: unsafe content rejected/sanitized ----

  it('10a. a section field containing an HTML/script tag is stripped, not stored as HTML', async () => {
    const { cookie } = await makeAdminWith('cms.pages.create', 'cms.pages.read')
    const res = await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({
      slug: `unsafe-${Date.now()}`,
      title: 'Unsafe Test',
      sections: [{ type: 'text', fields: { body: '<script>alert(1)</script>Hello' } }],
    }).expect(201)
    expect(res.body.sections[0].fields.body).toBe('alert(1)Hello') // tags stripped, no <script> survives
    expect(res.body.sections[0].fields.body).not.toMatch(/[<>]/)
  })

  it('10b. an unsafe section link destination (javascript:) is rejected outright, not sanitized', async () => {
    const { cookie } = await makeAdminWith('cms.pages.create')
    await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({
      slug: `unsafe-link-${Date.now()}`,
      title: 'Unsafe Link Test',
      sections: [{ type: 'hero', fields: { title: 'x', ctaHref: 'javascript:alert(1)' } }],
    }).expect(400)
  })

  it('10c. an invalid section type is rejected (not silently accepted as arbitrary content)', async () => {
    const { cookie } = await makeAdminWith('cms.pages.create')
    await request(server).post('/admin/cms/pages').set('Cookie', cookie).send({
      slug: `unsafe-type-${Date.now()}`,
      title: 'Unsafe Type Test',
      sections: [{ type: 'raw_html_block', fields: { html: '<b>hi</b>' } }],
    }).expect(400)
  })

  it('CMS-managed navigation rejects an unsafe destination', async () => {
    const { cookie } = await makeAdminWith('cms.navigation.update')
    await request(server).post('/admin/cms/navigation').set('Cookie', cookie).send({ label: 'Evil', destination: '//evil.example.com' }).expect(400)
    await request(server).post('/admin/cms/navigation').set('Cookie', cookie).send({ label: 'Evil2', destination: 'javascript:alert(1)' }).expect(400)
    const ok = await request(server).post('/admin/cms/navigation').set('Cookie', cookie).send({ label: 'Fine', destination: '/markets' }).expect(201)
    expect(ok.body.destination).toBe('/markets')
  })

  it('announcements respect audience (loggedInOnly) and publish state end-to-end', async () => {
    const { cookie } = await makeAdminWith('cms.announcements.create', 'cms.announcements.publish')
    const createRes = await request(server).post('/admin/cms/announcements').set('Cookie', cookie).send({ title: 'Members only', body: 'Hello', loggedInOnly: true }).expect(201)
    await request(server).post(`/admin/cms/announcements/${createRes.body.id}/publish`).set('Cookie', cookie).send({}).expect(201)

    const anonymous = await request(server).get('/cms/announcements').expect(200)
    expect(anonymous.body.find((a: any) => a.id === createRes.body.id)).toBeUndefined()

    const userEmail = uniqueEmail('announceviewer')
    await createUserDirect(prisma, { email: userEmail, password: 'correct-horse-battery', role: 'USER' })
    const userCookie = await loginAs(userEmail, 'correct-horse-battery')
    const loggedIn = await request(server).get('/cms/announcements').set('Cookie', userCookie).expect(200)
    expect(loggedIn.body.find((a: any) => a.id === createRes.body.id)).toBeDefined()
  })
})
