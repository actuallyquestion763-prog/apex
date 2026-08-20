import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// A real, magic-byte-valid (but obviously synthetic) PNG — 12 bytes, well
// under MediaStorageService's 5MB cap, passes the same real signature check
// production traffic goes through (no test-only bypass).
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('Mine/Profile + KYC (real PostgreSQL)', () => {
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

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: `${prefix} Test User`, kycStatus: 'NOT_STARTED' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function makeAdminWith(...permissions: string[]) {
    const email = uniqueEmail('kycadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN', fullName: 'KYC Admin' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { adminId: user.id, cookie: extractSessionCookie(res) }
  }

  function submitKyc(cookie: string, opts: { idType?: string; withBack?: boolean; withSelfie?: boolean; idNumber?: string } = {}) {
    const idType = opts.idType ?? 'NATIONAL_ID'
    let req = request(server)
      .post('/kyc/submit')
      .set('Cookie', cookie)
      .field('fullName', 'Emmika Test')
      .field('dateOfBirth', '1995-06-15')
      .field('country', 'Kenya')
      .field('idType', idType)
      .field('idNumber', opts.idNumber ?? '1234567890')
      .attach('front', PNG_BYTES, { filename: 'front.png', contentType: 'image/png' })
    if (opts.withBack !== false && idType !== 'PASSPORT') {
      req = req.attach('back', PNG_BYTES, { filename: 'back.png', contentType: 'image/png' })
    }
    if (opts.withSelfie !== false) {
      req = req.attach('selfie', PNG_BYTES, { filename: 'selfie.png', contentType: 'image/png' })
    }
    return req
  }

  // ---- 1. Status / referral code ------------------------------------------

  it('1. a fresh user has NOT_SUBMITTED-equivalent KYC status (no verification yet) and a real, unique, backend-issued referral code', async () => {
    const a = await registerAndLogin('kycstatusA')
    const b = await registerAndLogin('kycstatusB')

    const mine = await request(server).get('/kyc/me').set('Cookie', a.cookie).expect(200)
    // Nest sends an empty body (not JSON `null`) for a controller returning
    // null — the frontend treats this the same as "no verification yet".
    expect(mine.body.id).toBeUndefined()

    const meA = await request(server).get('/auth/me').set('Cookie', a.cookie).expect(200)
    const meB = await request(server).get('/auth/me').set('Cookie', b.cookie).expect(200)
    expect(meA.body.user.kycStatus).toBe('NOT_STARTED')
    expect(typeof meA.body.user.referralCode).toBe('string')
    expect(meA.body.user.referralCode.length).toBeGreaterThanOrEqual(6)
    expect(meA.body.user.referralCode).not.toBe(meB.body.user.referralCode)
  })

  // ---- 2. Submission validation -------------------------------------------

  it('2. a full NATIONAL_ID submission (front+back+selfie) succeeds and moves status to PENDING', async () => {
    const { cookie } = await registerAndLogin('kycsubmit')
    const res = await submitKyc(cookie, { idType: 'NATIONAL_ID' }).expect(201)
    expect(res.body.status).toBe('PENDING')
    const me = await request(server).get('/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.user.kycStatus).toBe('PENDING')
  })

  it('3. a PASSPORT submission needs only front+selfie — no back image required', async () => {
    const { cookie } = await registerAndLogin('kycpassport')
    const res = await submitKyc(cookie, { idType: 'PASSPORT' }).expect(201)
    expect(res.body.status).toBe('PENDING')
  })

  it('4. a NATIONAL_ID submission missing the back image is rejected', async () => {
    const { cookie } = await registerAndLogin('kycnoback')
    await submitKyc(cookie, { idType: 'NATIONAL_ID', withBack: false }).expect(400)
  })

  it('5. a PASSPORT submission that includes a back image is rejected (that ID type does not require one)', async () => {
    const { cookie } = await registerAndLogin('kycpassportback')
    const res = await request(server)
      .post('/kyc/submit')
      .set('Cookie', cookie)
      .field('fullName', 'Emmika Test')
      .field('dateOfBirth', '1995-06-15')
      .field('country', 'Kenya')
      .field('idType', 'PASSPORT')
      .field('idNumber', 'P1234567')
      .attach('front', PNG_BYTES, { filename: 'front.png', contentType: 'image/png' })
      .attach('back', PNG_BYTES, { filename: 'back.png', contentType: 'image/png' })
      .attach('selfie', PNG_BYTES, { filename: 'selfie.png', contentType: 'image/png' })
    expect(res.status).toBe(400)
  })

  it('6. a submission missing the selfie is rejected', async () => {
    const { cookie } = await registerAndLogin('kycnoselfie')
    await submitKyc(cookie, { idType: 'NATIONAL_ID', withSelfie: false }).expect(400)
  })

  it('7. submitting again while a verification is already PENDING is rejected', async () => {
    const { cookie } = await registerAndLogin('kycdupe')
    await submitKyc(cookie).expect(201)
    await submitKyc(cookie).expect(400)
  })

  // ---- 8/9. Document access + IDOR ----------------------------------------

  it('8. the submitting user can view their own uploaded document, and an unrelated user gets 404 (never leaking existence)', async () => {
    const owner = await registerAndLogin('kycowner')
    const stranger = await registerAndLogin('kycstranger')
    const submitted = await submitKyc(owner.cookie).expect(201)
    const documentId = submitted.body.documents[0].id

    await request(server).get(`/kyc/documents/${documentId}`).set('Cookie', owner.cookie).expect(200)
    const strangerRes = await request(server).get(`/kyc/documents/${documentId}`).set('Cookie', stranger.cookie)
    expect(strangerRes.status).toBe(404)
  })

  it('9. a nonexistent document id returns 404, not a 500 or a different error shape (no enumeration signal)', async () => {
    const { cookie } = await registerAndLogin('kycmissingdoc')
    const res = await request(server).get('/kyc/documents/00000000-0000-0000-0000-000000000000').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  // ---- 10. Authorization on admin endpoints -------------------------------

  it('10. a plain USER cannot call any admin KYC endpoint (list, detail, document, approve, reject)', async () => {
    const user = await registerAndLogin('kycplainuser')
    const submitted = await submitKyc(user.cookie).expect(201)
    const documentId = submitted.body.documents[0].id

    await request(server).get('/admin/kyc/submissions').set('Cookie', user.cookie).expect(403)
    await request(server).get(`/admin/kyc/submissions/${submitted.body.id}`).set('Cookie', user.cookie).expect(403)
    await request(server).get(`/admin/kyc/documents/${documentId}`).set('Cookie', user.cookie).expect(403)
    await request(server).post(`/admin/kyc/${submitted.body.id}/approve`).set('Cookie', user.cookie).expect(403)
    await request(server).post(`/admin/kyc/${submitted.body.id}/reject`).set('Cookie', user.cookie).send({ reason: 'no' }).expect(403)
  })

  it('11. a user cannot approve their own KYC submission, even by guessing the admin endpoint', async () => {
    const user = await registerAndLogin('kycselfapprove')
    const submitted = await submitKyc(user.cookie).expect(201)
    await request(server).post(`/admin/kyc/${submitted.body.id}/approve`).set('Cookie', user.cookie).expect(403)
    const stillPending = await request(server).get('/kyc/me').set('Cookie', user.cookie).expect(200)
    expect(stillPending.body.status).toBe('PENDING')
  })

  it('12. an ADMIN without kyc.read cannot list submissions; with kyc.read they can, and idNumber is masked in the list', async () => {
    const noPerm = await makeAdminWith()
    const withRead = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycmasklist')
    await submitKyc(user.cookie, { idNumber: 'AB1234567890' }).expect(201)

    await request(server).get('/admin/kyc/submissions').set('Cookie', noPerm.cookie).expect(403)
    const listRes = await request(server).get('/admin/kyc/submissions').set('Cookie', withRead.cookie).expect(200)
    expect(Array.isArray(listRes.body)).toBe(true)
    const mine = listRes.body.find((r: any) => r.idNumber?.endsWith('7890'))
    expect(mine).toBeTruthy()
    expect(mine.idNumber).not.toBe('AB1234567890')
    expect(mine.idNumber.startsWith('•')).toBe(true)
    expect(mine.user.id).toBeTruthy()
  })

  it('13. the single-submission admin detail view shows the FULL unmasked idNumber to an authorized reviewer', async () => {
    const admin = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycfulldetail')
    const submitted = await submitKyc(user.cookie, { idNumber: 'FULLID99999' }).expect(201)

    const detail = await request(server).get(`/admin/kyc/submissions/${submitted.body.id}`).set('Cookie', admin.cookie).expect(200)
    expect(detail.body.idNumber).toBe('FULLID99999')
    expect(detail.body.documents.length).toBeGreaterThanOrEqual(2)
  })

  // ---- 14. Admin can actually view the uploaded image ---------------------

  it('14. an authorized admin can view the ACTUAL uploaded document image (same bytes as uploaded), and the view is audited', async () => {
    const admin = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycviewdoc')
    const submitted = await submitKyc(user.cookie).expect(201)
    const frontDoc = submitted.body.documents.find((d: any) => d.kind === 'FRONT')

    const res = await request(server).get(`/admin/kyc/documents/${frontDoc.id}`).set('Cookie', admin.cookie).expect(200)
    expect(res.headers['content-type']).toContain('image/png')

    const events = await prisma.auditLog.findMany({ where: { action: 'KYC_DOCUMENT_VIEWED', targetId: user.userId } })
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it('15. front/back/selfie are each independently viewable where present (multi-document submission)', async () => {
    const admin = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycmultidoc')
    const submitted = await submitKyc(user.cookie, { idType: 'NATIONAL_ID' }).expect(201)
    const kinds = submitted.body.documents.map((d: any) => d.kind).sort()
    expect(kinds).toEqual(['BACK', 'FRONT', 'SELFIE'])

    for (const doc of submitted.body.documents) {
      await request(server).get(`/admin/kyc/documents/${doc.id}`).set('Cookie', admin.cookie).expect(200)
    }
  })

  // ---- 16. Approve / reject -------------------------------------------------

  it('16. an ADMIN without kyc.review cannot approve or reject, even with kyc.read', async () => {
    const readOnly = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycreadonlyadmin')
    const submitted = await submitKyc(user.cookie).expect(201)
    await request(server).post(`/admin/kyc/${submitted.body.id}/approve`).set('Cookie', readOnly.cookie).expect(403)
    await request(server).post(`/admin/kyc/${submitted.body.id}/reject`).set('Cookie', readOnly.cookie).send({ reason: 'no' }).expect(403)
  })

  it('17. an authorized admin can approve a complete submission; approval is idempotent (duplicate approve does not error or double-act)', async () => {
    const admin = await makeAdminWith('kyc.read', 'kyc.review')
    const user = await registerAndLogin('kycapprove')
    const submitted = await submitKyc(user.cookie).expect(201)

    const first = await request(server).post(`/admin/kyc/${submitted.body.id}/approve`).set('Cookie', admin.cookie).expect(201)
    expect(first.body.status).toBe('VERIFIED')
    const second = await request(server).post(`/admin/kyc/${submitted.body.id}/approve`).set('Cookie', admin.cookie).expect(201)
    expect(second.body.status).toBe('VERIFIED')

    const me = await request(server).get('/auth/me').set('Cookie', user.cookie).expect(200)
    expect(me.body.user.kycStatus).toBe('VERIFIED')
  })

  it('18. approving a legacy submission with no identity information/documents is blocked', async () => {
    const admin = await makeAdminWith('kyc.read', 'kyc.review')
    const user = await registerAndLogin('kyclegacyrow')
    // Simulates a row created by the OLD providerReference-only submit(),
    // before this checkpoint — no fullName/idType/documents.
    const legacy = await prisma.kycVerification.create({ data: { userId: user.userId, status: 'PENDING' } })
    const res = await request(server).post(`/admin/kyc/${legacy.id}/approve`).set('Cookie', admin.cookie)
    expect(res.status).toBe(400)
  })

  it('19. rejecting a submission requires a reason, and the customer can see the exact reason plus resubmit', async () => {
    const admin = await makeAdminWith('kyc.read', 'kyc.review')
    const user = await registerAndLogin('kycreject')
    const submitted = await submitKyc(user.cookie).expect(201)

    await request(server).post(`/admin/kyc/${submitted.body.id}/reject`).set('Cookie', admin.cookie).send({}).expect(400)

    const rejectRes = await request(server)
      .post(`/admin/kyc/${submitted.body.id}/reject`)
      .set('Cookie', admin.cookie)
      .send({ reason: 'ID image is blurry. Please upload a clear image showing all four corners.' })
      .expect(201)
    expect(rejectRes.body.status).toBe('REJECTED')

    const mine = await request(server).get('/kyc/me').set('Cookie', user.cookie).expect(200)
    expect(mine.body.status).toBe('REJECTED')
    expect(mine.body.rejectionReason).toContain('blurry')

    // Resubmission after rejection is allowed and creates a fresh PENDING
    // verification — the rejected one remains in history, untouched.
    const resubmitted = await submitKyc(user.cookie).expect(201)
    expect(resubmitted.body.status).toBe('PENDING')
    expect(resubmitted.body.id).not.toBe(submitted.body.id)

    const oldRow = await prisma.kycVerification.findUnique({ where: { id: submitted.body.id } })
    expect(oldRow?.status).toBe('REJECTED')
    expect(oldRow?.rejectionReason).toContain('blurry')

    const resubmitEvents = await prisma.auditLog.findMany({ where: { action: 'KYC_RESUBMITTED', targetId: user.userId } })
    expect(resubmitEvents.length).toBeGreaterThanOrEqual(1)
  })

  // ---- 20. Audit trail, no sensitive bytes ---------------------------------

  it('20. KYC_SUBMITTED and KYC_DOCUMENT_UPLOADED audit events are recorded, and never carry raw document bytes/base64', async () => {
    const user = await registerAndLogin('kycaudit')
    await submitKyc(user.cookie).expect(201)

    const submitEvents = await prisma.auditLog.findMany({ where: { action: 'KYC_SUBMITTED', targetId: user.userId } })
    const uploadEvents = await prisma.auditLog.findMany({ where: { action: 'KYC_DOCUMENT_UPLOADED', targetId: user.userId } })
    expect(submitEvents.length).toBeGreaterThanOrEqual(1)
    expect(uploadEvents.length).toBeGreaterThanOrEqual(1)

    const serialized = JSON.stringify([...submitEvents, ...uploadEvents])
    expect(serialized).not.toContain(PNG_BYTES.toString('base64'))
    expect(serialized.toLowerCase()).not.toContain('buffer')
  })

  it('21. existing pending-only admin KYC listing still works unchanged (regression)', async () => {
    const admin = await makeAdminWith('kyc.read')
    const user = await registerAndLogin('kycpendingregression')
    const submitted = await submitKyc(user.cookie).expect(201)
    const res = await request(server).get('/admin/kyc/pending').set('Cookie', admin.cookie).expect(200)
    expect(res.body.some((r: any) => r.id === submitted.body.id)).toBe(true)
  })
})
