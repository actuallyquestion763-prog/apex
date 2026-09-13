import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { EmailService } from '../src/email/email.service'
import type { SupportNotificationEmailParams } from '../src/email/templates/support-notification.template'
import type { PrismaService } from '../src/prisma/prisma.service'

// ADMIN NOTIFICATIONS (Support) — "New Support Ticket" / "Customer Reply"
// emails to the address configured in PlatformSettings.supportNotificationEmail
// (backend/src/support/support.service.ts's sendAdminNotification()).
// SMTP itself is never exercised here (.env.test has no SMTP_HOST, same as
// every other e2e suite) — EmailService is overridden with a fake that
// records calls instead of sending real mail, exactly like
// forgot-password.e2e-spec.ts already does for password-reset emails.
class FakeEmailService {
  sent: { toEmail: string; params: SupportNotificationEmailParams }[] = []
  shouldFail = false
  async sendSupportNotificationEmail(toEmail: string, params: SupportNotificationEmailParams) {
    if (this.shouldFail) throw new Error('Simulated SMTP failure')
    this.sent.push({ toEmail, params })
  }
}

describe('Support — ADMIN NOTIFICATIONS emails (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any
  let categoryId: string
  let fakeEmail: FakeEmailService
  let superCookie: string
  let superPassword: string

  beforeAll(async () => {
    fakeEmail = new FakeEmailService()
    const t = await createTestApp((builder) => builder.overrideProvider(EmailService).useValue(fakeEmail))
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()

    const category = await prisma.supportCategory.upsert({
      where: { name: 'Admin Notification Test Category' },
      create: { name: 'Admin Notification Test Category' },
      update: {},
    })
    categoryId = category.id

    const email = uniqueEmail('notifysuper')
    superPassword = 'correct-horse-battery'
    await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    superCookie = extractSessionCookie(loginRes)
  })

  afterAll(async () => {
    // PlatformSettings is a global singleton row shared by every e2e suite
    // in this test database — leave it clean for whichever suite runs next.
    await prisma.platformSettings.updateMany({ data: { supportNotificationEmail: null } })
    await app.close()
  })

  beforeEach(() => {
    fakeEmail.sent = []
    fakeEmail.shouldFail = false
  })

  // Real requests through the actual step-up-gated admin endpoint set a
  // value (exercising the real DTO/audit path); clearing goes straight to
  // Prisma since the admin PATCH has no "clear to null" path (same,
  // pre-existing limitation as its supportAutoGreetingMessage sibling) —
  // this is purely test setup/isolation, not something a real admin does.
  async function setNotificationEmail(value: string) {
    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', superCookie)
      .send({ supportNotificationEmail: value, reason: 'e2e: configure support notification email', confirmPassword: superPassword })
      .expect(200)
  }

  async function clearNotificationEmail() {
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', supportNotificationEmail: null },
      update: { supportNotificationEmail: null },
    })
  }

  async function makeCustomer(prefix: string, fullName?: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName, role: 'USER' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, email, cookie: extractSessionCookie(res) }
  }

  // ---- 6. Recipient comes from the configured setting -------------------------------

  it('6. does nothing at all while no notification email is configured — never a hardcoded fallback', async () => {
    await clearNotificationEmail()
    const customer = await makeCustomer('noaddr')
    await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    expect(fakeEmail.sent).toHaveLength(0)
  })

  // ---- 1. New ticket -> admin email sent --------------------------------------------

  it('1. creating a new support ticket sends exactly one admin notification email, to the configured address', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('newticket', 'Jordan Customer')
    const res = await request(server).post('/support/tickets').set('Cookie', customer.cookie)
      .send({ categoryId, subject: 'Withdrawal missing', message: 'It has been 3 days and I have not received my funds.' }).expect(201)

    expect(fakeEmail.sent).toHaveLength(1)
    const sent = fakeEmail.sent[0]
    expect(sent.toEmail).toBe('ops-inbox@edgecryptotrade.site')
    expect(sent.params.kind).toBe('NEW_TICKET')
    expect(sent.params.ticketId).toBe(res.body.id)
  })

  // ---- 7. Email content contains correct ticket/customer information ---------------

  it('7. the new-ticket email contains the real customer, ticket subject, category, and message preview', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('content', 'Priya Verma')
    await request(server).post('/support/tickets').set('Cookie', customer.cookie)
      .send({ categoryId, subject: 'Cannot verify KYC', message: 'My ID upload keeps failing on the verification page.' }).expect(201)

    const { params } = fakeEmail.sent[0]
    expect(params.customerLabel).toBe('Priya Verma')
    expect(params.ticketSubject).toBe('Cannot verify KYC')
    expect(params.categoryName).toBe('Admin Notification Test Category')
    expect(params.messagePreview).toContain('My ID upload keeps failing')
  })

  it('7b. falls back to the customer email when no full name is on file — never fabricates a name', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const email = uniqueEmail('noname')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: '', role: 'USER' })
    const login = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const cookie = extractSessionCookie(login)
    await request(server).post('/support/tickets').set('Cookie', cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    expect(fakeEmail.sent[0].params.customerLabel).toBe(email)
  })

  // ---- 8. No credentials/tokens leaked in email -------------------------------------

  it('8. the ticket URL carries no auth token/session cookie — just a plain ticket id into the existing authenticated admin route', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('security')
    const res = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    const { params } = fakeEmail.sent[0]
    expect(params.ticketUrl).toContain('/admin/support')
    expect(params.ticketUrl).toContain(res.body.id)
    expect(params.ticketUrl).not.toMatch(/token|session|jwt|password|secret/i)
    expect(JSON.stringify(params)).not.toMatch(/token|session|password|secret/i)
  })

  // ---- 2. Customer reply -> admin email sent ----------------------------------------

  it('2. a customer reply on an existing ticket sends a second admin notification email', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('reply')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    expect(fakeEmail.sent).toHaveLength(1) // from ticket creation

    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', customer.cookie).send({ body: 'Any update on this?' }).expect(201)

    expect(fakeEmail.sent).toHaveLength(2)
    const replyEmail = fakeEmail.sent[1]
    expect(replyEmail.params.kind).toBe('CUSTOMER_REPLY')
    expect(replyEmail.params.messagePreview).toBe('Any update on this?')
  })

  // ---- 3. Admin reply -> no admin self-notification ---------------------------------

  it('3. an admin/staff reply never triggers an admin notification email', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('staffreply')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    fakeEmail.sent = [] // clear the new-ticket email so this test is only about the staff reply

    await request(server)
      .post(`/admin/support/tickets/${ticket.body.id}/messages`)
      .set('Cookie', superCookie)
      .send({ body: 'We are looking into this now.' })
      .expect(201)

    expect(fakeEmail.sent).toHaveLength(0)
  })

  // ---- 4. Email provider failure -> ticket/message still succeeds ------------------

  it('4a. a ticket is still created successfully even when the email provider throws', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    fakeEmail.shouldFail = true
    const customer = await makeCustomer('emailfail')
    const res = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    expect(res.body.status).toBe('OPEN')

    const stored = await prisma.supportTicket.findUnique({ where: { id: res.body.id } })
    expect(stored).not.toBeNull()
  })

  it('4b. a customer reply still saves successfully even when the email provider throws', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('emailfail2')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    fakeEmail.shouldFail = true
    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', customer.cookie).send({ body: 'Still there?' }).expect(201)

    const detail = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', customer.cookie).expect(200)
    expect(detail.body.messages).toHaveLength(2)
  })

  // ---- 5. Duplicate request -> only one notification --------------------------------
  // No idempotency-key layer exists (or was added) for ticket/message
  // creation — the task explicitly forbids changing that behavior. This
  // verifies the actually-controllable guarantee instead: ONE successful
  // create() call results in exactly ONE email attempt, never two, and the
  // email is sent once the write has committed rather than from inside the
  // transaction (so a transaction-level retry could never double-send).
  it('5. one ticket-creation request results in exactly one admin notification email, not two', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('dupe')
    await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    expect(fakeEmail.sent).toHaveLength(1)
  })

  it('5b. one customer-reply request results in exactly one admin notification email, not two', async () => {
    await setNotificationEmail('ops-inbox@edgecryptotrade.site')
    const customer = await makeCustomer('dupe2')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    fakeEmail.sent = []

    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', customer.cookie).send({ body: 'One more thing' }).expect(201)
    expect(fakeEmail.sent).toHaveLength(1)
  })
})
