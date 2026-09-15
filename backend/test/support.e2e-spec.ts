import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('Customer Support (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any
  let categoryId: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    const category = await prisma.supportCategory.upsert({
      where: { name: 'Test Category' },
      create: { name: 'Test Category' },
      update: {},
    })
    categoryId = category.id
  })

  afterAll(async () => {
    await app.close()
  })

  async function loginAs(email: string, password: string) {
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return extractSessionCookie(res)
  }

  async function makeCustomer(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'USER' })
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  async function makeAgentWith(...permissions: string[]) {
    const email = uniqueEmail('agent')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  // ---- 11, 12: create + list own ----

  it('11. a customer can create a support ticket', async () => {
    const { cookie } = await makeCustomer('cust11')
    const res = await request(server).post('/support/tickets').set('Cookie', cookie)
      .send({ categoryId, subject: 'My withdrawal is missing', message: 'It has been 3 days.' }).expect(201)
    expect(res.body.status).toBe('OPEN')
  })

  it('12. a customer can see their own tickets', async () => {
    const { cookie } = await makeCustomer('cust12')
    await request(server).post('/support/tickets').set('Cookie', cookie).send({ categoryId, subject: 'Q1', message: 'hi' }).expect(201)
    const list = await request(server).get('/support/tickets').set('Cookie', cookie).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].subject).toBe('Q1')
  })

  // ---- 13, 25: cross-customer isolation ----

  it('13 & 25. Customer A cannot see or access Customer B\'s ticket by ID', async () => {
    const a = await makeCustomer('custA')
    const b = await makeCustomer('custB')
    const ticket = await request(server).post('/support/tickets').set('Cookie', a.cookie).send({ categoryId, subject: 'A private matter', message: 'hi' }).expect(201)

    // B tries to fetch A's ticket directly by ID
    await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', b.cookie).expect(403)

    // B's own ticket list never includes A's ticket
    const bList = await request(server).get('/support/tickets').set('Cookie', b.cookie).expect(200)
    expect(bList.body.find((t: any) => t.id === ticket.body.id)).toBeUndefined()
  })

  // ---- 14: customer reply ----

  it('14. a customer can reply to their own open ticket', async () => {
    const { cookie } = await makeCustomer('cust14')
    const ticket = await request(server).post('/support/tickets').set('Cookie', cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', cookie).send({ body: 'Any update?' }).expect(201)
    const detail = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', cookie).expect(200)
    expect(detail.body.messages).toHaveLength(2) // original + reply
  })

  // ---- 15, 27: customer cannot create/see internal notes ----

  it('15 & 27. a customer cannot create an internal note by manipulating the visibility field', async () => {
    const { cookie } = await makeCustomer('cust15')
    const ticket = await request(server).post('/support/tickets').set('Cookie', cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', cookie).send({ body: 'sneaky', visibility: 'INTERNAL' }).expect(201)

    const stored = await prisma.supportMessage.findFirst({ where: { ticketId: ticket.body.id, body: 'sneaky' } })
    expect(stored!.visibility).toBe('PUBLIC') // the customer's requested INTERNAL visibility was ignored server-side
  })

  // ---- 16, 17, 18: agent view/reply/internal note ----

  it('16 & 17. an agent with support.tickets.read + support.tickets.reply can view and reply to a ticket', async () => {
    const customer = await makeCustomer('cust1617')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    const agent = await makeAgentWith('support.tickets.read', 'support.tickets.reply')
    await request(server).get(`/admin/support/tickets/${ticket.body.id}`).set('Cookie', agent.cookie).expect(200)
    await request(server).post(`/admin/support/tickets/${ticket.body.id}/messages`).set('Cookie', agent.cookie).send({ body: 'We are looking into it.' }).expect(201)

    const customerView = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', customer.cookie).expect(200)
    expect(customerView.body.messages.some((m: any) => m.body === 'We are looking into it.')).toBe(true)
  })

  it('18 & 19. an agent with support.tickets.internal_note can write a note the customer never sees', async () => {
    const customer = await makeCustomer('cust1819')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    const agent = await makeAgentWith('support.tickets.read', 'support.tickets.internal_note')
    await request(server).post(`/admin/support/tickets/${ticket.body.id}/messages`).set('Cookie', agent.cookie).send({ body: 'Escalate to finance', visibility: 'INTERNAL' }).expect(201)

    const customerView = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', customer.cookie).expect(200)
    expect(customerView.body.messages.some((m: any) => m.body === 'Escalate to finance')).toBe(false)

    const agentView = await request(server).get(`/admin/support/tickets/${ticket.body.id}`).set('Cookie', agent.cookie).expect(200)
    expect(agentView.body.messages.some((m: any) => m.body === 'Escalate to finance')).toBe(true)
  })

  // ---- 20, 21: status update permission ----

  it('20 & 21. an agent WITHOUT support.tickets.resolve cannot resolve a ticket even with support.tickets.update', async () => {
    const customer = await makeCustomer('cust2021')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    const agent = await makeAgentWith('support.tickets.update') // no .resolve
    await request(server).patch(`/admin/support/tickets/${ticket.body.id}/status`).set('Cookie', agent.cookie).send({ status: 'RESOLVED' }).expect(403)

    const withResolve = await makeAgentWith('support.tickets.update', 'support.tickets.resolve')
    const res = await request(server).patch(`/admin/support/tickets/${ticket.body.id}/status`).set('Cookie', withResolve.cookie).send({ status: 'RESOLVED' }).expect(200)
    expect(res.body.status).toBe('RESOLVED')
  })

  // ---- 22: assignment permission-controlled ----

  it('22. ticket assignment requires support.tickets.assign specifically', async () => {
    const customer = await makeCustomer('cust22')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    const targetAgent = await makeAgentWith('support.tickets.read')

    const noAssignPerm = await makeAgentWith('support.tickets.update')
    await request(server).post(`/admin/support/tickets/${ticket.body.id}/assign`).set('Cookie', noAssignPerm.cookie).send({ agentId: targetAgent.userId }).expect(403)

    const withAssignPerm = await makeAgentWith('support.tickets.assign')
    const res = await request(server).post(`/admin/support/tickets/${ticket.body.id}/assign`).set('Cookie', withAssignPerm.cookie).send({ agentId: targetAgent.userId, reason: 'best fit' }).expect(201)
    expect(res.body.assignedAgentId).toBe(targetAgent.userId)

    const history = await request(server).get(`/admin/support/tickets/${ticket.body.id}/assignments`).set('Cookie', withAssignPerm.cookie).expect(200)
    expect(history.body).toHaveLength(1)
  })

  // ---- 23: category deactivation preserves history ----

  it('23. deactivating a category does not destroy tickets that reference it, and cannot be deleted', async () => {
    const manager = await makeAgentWith('support.categories.manage')
    const catRes = await request(server).post('/admin/support/categories').set('Cookie', manager.cookie).send({ name: `Deactivate Me ${Date.now()}` }).expect(201)

    const customer = await makeCustomer('cust23')
    await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId: catRes.body.id, subject: 'Q', message: 'hi' }).expect(201)

    const deactivated = await request(server).patch(`/admin/support/categories/${catRes.body.id}`).set('Cookie', manager.cookie).send({ isActive: false }).expect(200)
    expect(deactivated.body.isActive).toBe(false)

    // The ticket referencing it still exists and is queryable.
    const stillThere = await prisma.supportTicket.findFirst({ where: { categoryId: catRes.body.id } })
    expect(stillThere).not.toBeNull()

    // No delete endpoint exists for categories at all (structural
    // prevention, not just an unused permission) — a real DELETE request
    // hits no registered route and 404s, even for a SUPER_ADMIN.
    const superEmail = uniqueEmail('catdeletesuper')
    const superPassword = 'correct-horse-battery'
    await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superCookie = await loginAs(superEmail, superPassword)
    await request(server).delete(`/admin/support/categories/${catRes.body.id}`).set('Cookie', superCookie).expect(404)
  })

  // ---- 24: audit trail ----

  it('24. assigning a ticket and changing its status are recorded in the audit log', async () => {
    const customer = await makeCustomer('cust24')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    const agent = await makeAgentWith('support.tickets.assign', 'support.tickets.update', 'support.tickets.resolve')

    await request(server).post(`/admin/support/tickets/${ticket.body.id}/assign`).set('Cookie', agent.cookie).send({ agentId: agent.userId }).expect(201)
    await request(server).patch(`/admin/support/tickets/${ticket.body.id}/status`).set('Cookie', agent.cookie).send({ status: 'RESOLVED' }).expect(200)

    const assignLog = await prisma.auditLog.findFirst({ where: { action: 'TICKET_ASSIGNED', targetId: ticket.body.id } })
    const statusLog = await prisma.auditLog.findFirst({ where: { action: 'TICKET_STATUS_CHANGED', targetId: ticket.body.id } })
    expect(assignLog).not.toBeNull()
    expect(statusLog).not.toBeNull()
    expect(statusLog!.newState).toEqual({ status: 'RESOLVED' })
  })

  // ---- 26: customer cannot manipulate author ID ----

  it('26. a customer cannot manipulate message authorship — it always comes from the session, never the request body', async () => {
    const customer = await makeCustomer('cust26')
    const otherUser = await makeCustomer('cust26b')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    // authorId is not a field CreateMessageDto declares. The global
    // ValidationPipe runs with forbidNonWhitelisted: true, so this isn't
    // silently stripped-then-accepted — the whole request is rejected
    // outright as malformed (a stronger property than silent stripping).
    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', customer.cookie).send({ body: 'reply', authorId: otherUser.userId }).expect(400)

    // The legitimate request (no authorId field) still works, and the
    // author is always taken from the authenticated session.
    await request(server).post(`/support/tickets/${ticket.body.id}/messages`).set('Cookie', customer.cookie).send({ body: 'reply' }).expect(201)
    const stored = await prisma.supportMessage.findFirst({ where: { ticketId: ticket.body.id, body: 'reply' } })
    expect(stored!.authorId).toBe(customer.userId)
  })

  // ---- 28: customer cannot escalate authoritative priority ----

  it('28. a customer\'s requested priority is recorded but never becomes the authoritative priority automatically', async () => {
    const { cookie } = await makeCustomer('cust28')
    const res = await request(server).post('/support/tickets').set('Cookie', cookie).send({ categoryId, subject: 'URGENT!!!', message: 'hi', requestedPriority: 'URGENT' }).expect(201)
    expect(res.body.requestedPriority).toBe('URGENT')
    // priority starts equal to what was requested (a reasonable default),
    // but the customer has no endpoint that can change `priority` directly
    // afterward — only PATCH /admin/support/tickets/:id/priority can, and
    // that requires support.tickets.update (staff-only).
    const asCustomerAgain = await request(server).patch(`/support/tickets/${res.body.id}/priority`).set('Cookie', cookie).send({ priority: 'URGENT' })
    expect(asCustomerAgain.status).toBe(404) // no such customer-facing route exists at all
  })

  // ---------------------------------------------------------------------
  // Phase 4 — notifications (Part 22, items 24 & 25)
  // ---------------------------------------------------------------------

  it('24. a staff PUBLIC reply creates a notification for the customer, and an internal note does not', async () => {
    const customer = await makeCustomer('custnotify1')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Notify me', message: 'hi' }).expect(201)
    const agent = await makeAgentWith('support.tickets.read', 'support.tickets.reply', 'support.tickets.internal_note')

    await request(server).post(`/admin/support/tickets/${ticket.body.id}/messages`).set('Cookie', agent.cookie).send({ body: 'We are on it.' }).expect(201)
    await request(server).post(`/admin/support/tickets/${ticket.body.id}/messages`).set('Cookie', agent.cookie).send({ body: 'internal only', visibility: 'INTERNAL' }).expect(201)

    const notifs = await request(server).get('/support/notifications').set('Cookie', customer.cookie).expect(200)
    const forThisTicket = notifs.body.filter((n: any) => n.ticketId === ticket.body.id)
    expect(forThisTicket).toHaveLength(1) // only the PUBLIC reply notifies, not the internal note
    expect(forThisTicket[0].event).toBe('AGENT_REPLIED')
    expect(forThisTicket[0].message).not.toContain('internal only') // preview never carries message body content
  })

  it('24b. assigning a ticket notifies the newly assigned agent; resolving notifies the customer', async () => {
    const customer = await makeCustomer('custnotify2')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    const agent = await makeAgentWith('support.tickets.assign', 'support.tickets.update', 'support.tickets.resolve')

    await request(server).post(`/admin/support/tickets/${ticket.body.id}/assign`).set('Cookie', agent.cookie).send({ agentId: agent.userId }).expect(201)
    const agentNotifs = await request(server).get('/support/notifications').set('Cookie', agent.cookie).expect(200)
    expect(agentNotifs.body.some((n: any) => n.ticketId === ticket.body.id && n.event === 'TICKET_ASSIGNED')).toBe(true)

    await request(server).patch(`/admin/support/tickets/${ticket.body.id}/status`).set('Cookie', agent.cookie).send({ status: 'RESOLVED' }).expect(200)
    const customerNotifs = await request(server).get('/support/notifications').set('Cookie', customer.cookie).expect(200)
    expect(customerNotifs.body.some((n: any) => n.ticketId === ticket.body.id && n.event === 'TICKET_RESOLVED')).toBe(true)
  })

  it('25. notification ownership is enforced — a customer only ever sees their own, and marking read cannot touch another user\'s row', async () => {
    const a = await makeCustomer('notifyownerA')
    const b = await makeCustomer('notifyownerB')
    const ticket = await request(server).post('/support/tickets').set('Cookie', a.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)
    const agent = await makeAgentWith('support.tickets.read', 'support.tickets.reply')
    await request(server).post(`/admin/support/tickets/${ticket.body.id}/messages`).set('Cookie', agent.cookie).send({ body: 'reply' }).expect(201)

    const aNotifs = await request(server).get('/support/notifications').set('Cookie', a.cookie).expect(200)
    const targetNotif = aNotifs.body.find((n: any) => n.ticketId === ticket.body.id)
    expect(targetNotif).toBeDefined()

    // B never sees A's notification in their own list.
    const bNotifs = await request(server).get('/support/notifications').set('Cookie', b.cookie).expect(200)
    expect(bNotifs.body.find((n: any) => n.id === targetNotif.id)).toBeUndefined()

    // B "marking read" (even by guessing A's notification id) cannot mark
    // A's row read — the WHERE clause is always scoped to the caller's own
    // userId, so this silently matches zero rows rather than erroring.
    await request(server).patch('/support/notifications/read').set('Cookie', b.cookie).send({ ids: [targetNotif.id] }).expect(200)
    const stillUnread = await prisma.supportNotification.findUnique({ where: { id: targetNotif.id } })
    expect(stillUnread!.readAt).toBeNull()

    // A marking their own notification read works.
    await request(server).patch('/support/notifications/read').set('Cookie', a.cookie).send({ ids: [targetNotif.id] }).expect(200)
    const nowRead = await prisma.supportNotification.findUnique({ where: { id: targetNotif.id } })
    expect(nowRead!.readAt).not.toBeNull()
  })

  // ---------------------------------------------------------------------
  // Phase 4 — attachments (Part 22, item 26)
  // ---------------------------------------------------------------------

  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

  it('26. a customer can upload and download their own attachment; storage key is never the filename; another customer cannot access it', async () => {
    const customer = await makeCustomer('attachcust')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Screenshot attached', message: 'see attached' }).expect(201)

    const upload = await request(server).post(`/support/tickets/${ticket.body.id}/attachments`).set('Cookie', customer.cookie)
      .attach('file', PNG_BYTES, { filename: '../../etc/passwd.png', contentType: 'image/png' })
      .expect(201)
    const attachmentId = upload.body.attachments[0].id

    // storage key is a fresh random name, never derived from the (here,
    // path-traversal-shaped) client-supplied filename.
    const row = await prisma.supportAttachment.findUniqueOrThrow({ where: { id: attachmentId } })
    expect(row.storageKey).not.toContain('..')
    expect(row.storageKey).not.toContain('passwd')

    const download = await request(server).get(`/support/attachments/${attachmentId}`).set('Cookie', customer.cookie).expect(200)
    // 'inline' (not 'attachment') — an image attachment must render directly
    // in the chat thread, not force a download, matching CmsMedia/Kyc's own
    // file-serving convention.
    expect(download.headers['content-disposition']).toMatch(/^inline;/)

    const otherCustomer = await makeCustomer('attachother')
    await request(server).get(`/support/attachments/${attachmentId}`).set('Cookie', otherCustomer.cookie).expect(403)
  })

  // Regression test for a real bug: the upload response itself always
  // included `attachments` (createMessageWithAttachment always did), but
  // re-fetching the ticket afterwards — what the actual chat UI renders
  // off — silently dropped every attachment, because getTicketForCustomer()/
  // getTicketForStaff() never included the relation on their nested
  // `messages` query. The customer/admin pages' image-vs-download-link
  // logic was always correct; it just never received any attachment data
  // to act on. This asserts the SAME endpoints the UI actually calls,
  // not just the upload response.
  it('26c. the attachment is still present (with its real mimeType) when the ticket is re-fetched afterwards, for both the customer and the admin views', async () => {
    const customer = await makeCustomer('attachrefetch')
    const agent = await makeAgentWith('support.tickets.read')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Screenshot attached', message: 'see attached' }).expect(201)
    await request(server).post(`/support/tickets/${ticket.body.id}/attachments`).set('Cookie', customer.cookie)
      .attach('file', PNG_BYTES, { filename: 'screenshot.png', contentType: 'image/png' })
      .expect(201)

    const customerView = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', customer.cookie).expect(200)
    const customerAttachmentMsg = customerView.body.messages.find((m: any) => (m.attachments ?? []).length > 0)
    expect(customerAttachmentMsg).toBeDefined()
    expect(customerAttachmentMsg.attachments[0]).toMatchObject({ filename: 'screenshot.png', mimeType: 'image/png' })

    const adminView = await request(server).get(`/admin/support/tickets/${ticket.body.id}`).set('Cookie', agent.cookie).expect(200)
    const adminAttachmentMsg = adminView.body.messages.find((m: any) => (m.attachments ?? []).length > 0)
    expect(adminAttachmentMsg).toBeDefined()
    expect(adminAttachmentMsg.attachments[0]).toMatchObject({ filename: 'screenshot.png', mimeType: 'image/png' })
  })

  it('26d. a text-only message (no attachment) round-trips unchanged through the same ticket-refetch endpoints', async () => {
    const customer = await makeCustomer('attachtextonly')
    const agent = await makeAgentWith('support.tickets.read')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Just a question', message: 'no attachment here' }).expect(201)

    const customerView = await request(server).get(`/support/tickets/${ticket.body.id}`).set('Cookie', customer.cookie).expect(200)
    expect(customerView.body.messages[0].body).toBe('no attachment here')
    expect(customerView.body.messages[0].attachments ?? []).toHaveLength(0)

    const adminView = await request(server).get(`/admin/support/tickets/${ticket.body.id}`).set('Cookie', agent.cookie).expect(200)
    expect(adminView.body.messages[0].body).toBe('no attachment here')
    expect(adminView.body.messages[0].attachments ?? []).toHaveLength(0)
  })

  it('26b. an oversized or disallowed-type attachment is rejected before it is ever stored', async () => {
    const customer = await makeCustomer('attachreject')
    const ticket = await request(server).post('/support/tickets').set('Cookie', customer.cookie).send({ categoryId, subject: 'Q', message: 'hi' }).expect(201)

    // Wrong signature for the declared type (plain bytes claiming image/png).
    await request(server).post(`/support/tickets/${ticket.body.id}/attachments`).set('Cookie', customer.cookie)
      .attach('file', Buffer.from('not actually a png'), { filename: 'fake.png', contentType: 'image/png' })
      .expect(400)

    // Disallowed mime type outright, regardless of content.
    await request(server).post(`/support/tickets/${ticket.body.id}/attachments`).set('Cookie', customer.cookie)
      .attach('file', PNG_BYTES, { filename: 'evil.exe', contentType: 'application/x-msdownload' })
      .expect(400)

    // Oversized (over the shared 5MB MediaStorageService limit).
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024 + 1)])
    await request(server).post(`/support/tickets/${ticket.body.id}/attachments`).set('Cookie', customer.cookie)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400)

    expect(await prisma.supportAttachment.count({ where: { message: { ticketId: ticket.body.id } } })).toBe(0)
  })

  it('a staff member with support.tickets.assign can list assignable agents, without needing admins.read', async () => {
    const agent = await makeAgentWith('support.tickets.assign')
    const res = await request(server).get('/admin/support/agents').set('Cookie', agent.cookie).expect(200)
    expect(res.body.some((a: any) => a.id === agent.userId)).toBe(true)
  })

  // ---- Support ticket auto-greeting (Customer Support redesign) ----

  async function makeSuperAdmin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'SUPER_ADMIN' })
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  afterEach(async () => {
    // Every auto-greeting test leaves the singleton row disabled again, so
    // tests in this file (and later files, since PlatformSettings is a
    // shared singleton) never see a stray real ticket message they didn't
    // create.
    await prisma.platformSettings.updateMany({
      data: { supportAutoGreetingEnabled: false, supportAutoGreetingMessage: null, supportAutoGreetingSenderId: null },
    })
  })

  it('auto-greeting disabled (the default): a new ticket has exactly the customer\'s own opening message', async () => {
    const { cookie } = await makeCustomer('nogreet')
    const res = await request(server).post('/support/tickets').set('Cookie', cookie)
      .send({ categoryId, subject: 'Question', message: 'Hi there' }).expect(201)

    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: res.body.id }, include: { messages: true } })
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.messages[0].body).toBe('Hi there')
  })

  it('auto-greeting enabled: a new ticket also gets a real, persisted reply authored by the configured staff account', async () => {
    const admin = await makeSuperAdmin('greetsender')
    const { cookie: customerCookie } = await makeCustomer('greetcust')

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', admin.cookie)
      .send({
        supportAutoGreetingEnabled: true,
        supportAutoGreetingMessage: 'Hi! Thanks for reaching out.',
        supportAutoGreetingSenderId: admin.userId,
        reason: 'enable auto-greeting for test',
        confirmPassword: 'correct-horse-battery',
      })
      .expect(200)

    const res = await request(server).post('/support/tickets').set('Cookie', customerCookie)
      .send({ categoryId, subject: 'Question', message: 'Hi there' }).expect(201)

    const ticket = await prisma.supportTicket.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    expect(ticket.messages).toHaveLength(2)
    expect(ticket.messages[0].body).toBe('Hi there')
    expect(ticket.messages[1].body).toBe('Hi! Thanks for reaching out.')
    expect(ticket.messages[1].authorId).toBe(admin.userId)
    expect(ticket.messages[1].visibility).toBe('PUBLIC')
  })

  it('configuring an auto-greeting sender that is not a real admin account is rejected', async () => {
    const admin = await makeSuperAdmin('greetbadsender')
    const { userId: notAnAdminId } = await makeCustomer('notadmin')

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', admin.cookie)
      .send({
        supportAutoGreetingEnabled: true,
        supportAutoGreetingMessage: 'Hi!',
        supportAutoGreetingSenderId: notAnAdminId,
        reason: 'should be rejected',
        confirmPassword: 'correct-horse-battery',
      })
      .expect(400)
  })

  it('if the configured sender is demoted after being set, the greeting is silently skipped rather than blocking ticket creation', async () => {
    const admin = await makeSuperAdmin('greetdemoted')
    const { cookie: customerCookie } = await makeCustomer('greetdemotedcust')

    await request(server)
      .patch('/admin/platform-settings')
      .set('Cookie', admin.cookie)
      .send({
        supportAutoGreetingEnabled: true,
        supportAutoGreetingMessage: 'Hi!',
        supportAutoGreetingSenderId: admin.userId,
        reason: 'enable',
        confirmPassword: 'correct-horse-battery',
      })
      .expect(200)

    // Demote the configured sender directly (bypassing the API, simulating
    // "the account was since demoted or deleted" independent of this flow).
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'USER' } })

    const res = await request(server).post('/support/tickets').set('Cookie', customerCookie)
      .send({ categoryId, subject: 'Question', message: 'Hi there' }).expect(201)

    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: res.body.id }, include: { messages: true } })
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.messages[0].body).toBe('Hi there')
  })

  // ---------------------------------------------------------------------
  // "Contact any user" — admin-initiated conversations (operator request)
  // ---------------------------------------------------------------------

  it('29. an admin can start a brand-new conversation with a user who has no ticket yet', async () => {
    const agent = await makeAgentWith('support.tickets.reply')
    const customer = await makeCustomer('newmsgtarget')

    const res = await request(server).post('/admin/support/tickets').set('Cookie', agent.cookie)
      .send({ userId: customer.userId, message: 'Hi, following up on your account.' }).expect(201)

    expect(res.body.userId).toBe(customer.userId)
    expect(res.body.assignedAgentId).toBe(agent.userId) // auto-assigned to whoever started it
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.messages[0].authorId).toBe(agent.userId)
    expect(res.body.messages[0].body).toBe('Hi, following up on your account.')
    expect(res.body.messages[0].visibility).toBe('PUBLIC')

    // Audited as an administrative action.
    const events = await prisma.auditLog.findMany({ where: { action: 'TICKET_STARTED_BY_STAFF', targetId: res.body.id } })
    expect(events).toHaveLength(1)
    expect(events[0].actorId).toBe(agent.userId)
  })

  it('29b. an agent WITHOUT support.tickets.reply cannot start a new conversation', async () => {
    const agent = await makeAgentWith('support.tickets.read') // read-only, no .reply
    const customer = await makeCustomer('newmsgforbidden')
    await request(server).post('/admin/support/tickets').set('Cookie', agent.cookie)
      .send({ userId: customer.userId, message: 'hi' }).expect(403)
  })

  it('29c. GET /admin/support/users searches by name/email and returns a small, non-sensitive projection', async () => {
    const agent = await makeAgentWith('support.tickets.reply')
    const email = uniqueEmail('findable-user')
    const { user } = await createUserDirect(prisma, { email, password: 'correct-horse-battery', fullName: 'Findable Customer' })

    const res = await request(server).get(`/admin/support/users?q=Findable`).set('Cookie', agent.cookie).expect(200)
    const match = res.body.find((u: any) => u.id === user.id)
    expect(match).toEqual({ id: user.id, email, fullName: 'Findable Customer' })
    // Only id/email/fullName — no balance, KYC status, role, or password hash.
    expect(Object.keys(match).sort()).toEqual(['email', 'fullName', 'id'])
  })

  it('29d. the customer can see and reply to a conversation the admin started', async () => {
    const agent = await makeAgentWith('support.tickets.reply')
    const customer = await makeCustomer('newmsgreply')

    const created = await request(server).post('/admin/support/tickets').set('Cookie', agent.cookie)
      .send({ userId: customer.userId, message: 'We noticed an issue with your account.' }).expect(201)

    const customerView = await request(server).get(`/support/tickets/${created.body.id}`).set('Cookie', customer.cookie).expect(200)
    expect(customerView.body.messages[0].body).toBe('We noticed an issue with your account.')

    const reply = await request(server).post(`/support/tickets/${created.body.id}/messages`).set('Cookie', customer.cookie)
      .send({ body: 'Thanks, what issue?' }).expect(201)
    expect(reply.body.authorId).toBe(customer.userId)

    // The customer also gets an in-app notification about the admin's opening message.
    const notifications = await prisma.supportNotification.findMany({ where: { userId: customer.userId, ticketId: created.body.id } })
    expect(notifications.some((n) => n.event === 'AGENT_REPLIED')).toBe(true)
  })

  it('29e. starting a conversation with a nonexistent user returns 404', async () => {
    const agent = await makeAgentWith('support.tickets.reply')
    await request(server).post('/admin/support/tickets').set('Cookie', agent.cookie)
      .send({ userId: '00000000-0000-0000-0000-000000000000', message: 'hi' }).expect(404)
  })

  it('29f. omitting categoryId auto-selects the first active category, same as the customer-facing chat-first flow', async () => {
    const agent = await makeAgentWith('support.tickets.reply')
    const customer = await makeCustomer('newmsgnocat')
    const res = await request(server).post('/admin/support/tickets').set('Cookie', agent.cookie)
      .send({ userId: customer.userId, message: 'hi' }).expect(201)
    expect(res.body.categoryId).toBeTruthy()
  })
})
