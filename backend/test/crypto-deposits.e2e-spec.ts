import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode, grantPermissionDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { DepositsService } from '../src/deposits/deposits.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Checkpoint K — Crypto Deposit Management. Fake-but-valid test addresses
// only (Part 33's "clearly fake/test addresses ONLY where needed for
// automated tests") — real, format-valid addresses so the real
// cryptographic validator (address-validation.util.ts) is genuinely
// exercised, never a placeholder string that would only pass because
// validation was skipped.
const TEST_ETH_ADDRESS_A = '0x028693214AFA4E3bf4537175b5505315AFda80A3'
const TEST_ETH_ADDRESS_B = '0x054b4d2b3ff0aaecb688df5f735dfc4dc4b8695e'
const TEST_BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

describe('Crypto Deposit Management (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let deposits: DepositsService
  let server: any
  let superCookie: string
  let superPassword: string
  let superSecret: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    deposits = app.get(DepositsService)

    const email = uniqueEmail('cryptodepositsuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Crypto Deposit Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  let assetSeq = 0
  // Creates a fully-configured, enabled (asset + network + address) crypto
  // deposit route directly via Prisma — the admin-CRUD HTTP path is
  // exercised separately by its own dedicated tests below.
  async function setupCryptoAsset(opts: { symbol?: string; networkCode?: string; address?: string; minimumDeposit?: string; assetEnabled?: boolean; networkEnabled?: boolean } = {}) {
    assetSeq += 1
    // Includes Date.now() (not just a per-run counter) so re-running this
    // file against the same disposable database — which is never truncated
    // between separate `jest` invocations — never collides with rows a
    // previous run already left behind.
    const symbol = opts.symbol ?? `TST${assetSeq}-${Date.now()}`
    const networkCode = opts.networkCode ?? 'ERC20'
    const asset = await prisma.cryptoAsset.create({ data: { symbol, name: `Test Asset ${assetSeq}`, enabled: opts.assetEnabled ?? true } })
    const network = await prisma.cryptoDepositAddress.create({
      data: {
        cryptoAssetId: asset.id,
        networkCode,
        networkName: networkCode,
        enabled: opts.networkEnabled ?? true,
        receivingAddress: opts.address ?? TEST_ETH_ADDRESS_A,
        minimumDeposit: opts.minimumDeposit ?? null,
      },
    })
    return { symbol, networkCode, asset, network }
  }

  function createCryptoDeposit(cookie: string, body: Record<string, unknown>) {
    return request(server).post('/deposits').set('Cookie', cookie).send({ method: 'CRYPTO', ...body })
  }

  // ---- 1. Internal Transfer still works ---------------------------------------

  it('1. Internal Transfer (the pre-existing, non-crypto deposit path) still works exactly as before', async () => {
    const { userId, cookie } = await registerAndLogin('internaltransfer')
    const res = await request(server).post('/deposits').set('Cookie', cookie).send({ method: 'INTERNAL_TRANSFER', amount: '250' }).expect(201)
    expect(res.body.status).toBe('PENDING')
    expect(res.body.currency).toBe('USD')
    expect(res.body.cryptoAssetSymbol).toBeNull()

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id, 'USD')
    expect(balances.cash.toString()).toBe('0') // still PENDING — never auto-credited
  })

  // ---- 2/3. Crypto method + supported list ------------------------------------

  it('2/3. the supported crypto asset list loads from backend configuration, never hardcoded', async () => {
    const { symbol } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('assetlist')
    const res = await request(server).get('/crypto-deposits/assets').set('Cookie', cookie).expect(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.some((a: any) => a.symbol === symbol)).toBe(true)
  })

  // ---- 4. Disabled crypto rejected --------------------------------------------

  it('4. a disabled crypto asset is rejected for both address resolution and deposit creation', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ assetEnabled: false })
    const { cookie } = await registerAndLogin('disabledasset')

    await request(server).get(`/crypto-deposits/assets/${symbol}/networks/${networkCode}`).set('Cookie', cookie).expect(400)
    const res = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ASSET_DISABLED/)
  })

  // ---- 5. Supported networks load ---------------------------------------------

  it('5. only networks configured for the selected crypto are returned, never a hardcoded incompatible combination', async () => {
    const { symbol } = await setupCryptoAsset({ networkCode: 'TRC20' })
    const { cookie } = await registerAndLogin('networklist')
    const res = await request(server).get('/crypto-deposits/assets').set('Cookie', cookie).expect(200)
    const asset = res.body.find((a: any) => a.symbol === symbol)
    expect(asset.networks.map((n: any) => n.networkCode)).toEqual(['TRC20'])
  })

  // ---- 6. Invalid crypto/network combination rejected -------------------------

  it('6. a network never configured for this asset (e.g. BTC + TRC20 style mismatch) is rejected', async () => {
    const { symbol } = await setupCryptoAsset({ networkCode: 'ERC20' })
    const { cookie } = await registerAndLogin('badcombo')
    const res = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode: 'BEP20' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/NETWORK_DISABLED/)
  })

  // ---- 7. Disabled network rejected --------------------------------------------

  it('7. a disabled network is rejected even though the asset itself is enabled', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ networkEnabled: false })
    const { cookie } = await registerAndLogin('disablednetwork')
    const res = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/NETWORK_DISABLED/)
  })

  // ---- 8. Active receiving address returned ------------------------------------

  it('8. resolving an enabled asset+network returns exactly the configured active receiving address', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ address: TEST_BTC_ADDRESS, networkCode: 'BTC' })
    const { cookie } = await registerAndLogin('resolveaddress')
    const res = await request(server).get(`/crypto-deposits/assets/${symbol}/networks/${networkCode}`).set('Cookie', cookie).expect(200)
    expect(res.body.receivingAddress).toBe(TEST_BTC_ADDRESS)
    expect(res.body.networkCode).toBe('BTC')
  })

  // ---- 11. Minimum deposit validation --------------------------------------------

  it('11. an amount below the configured minimum is rejected with a clear message, and zero rows are created', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ minimumDeposit: '50' })
    const { userId, cookie } = await registerAndLogin('minamount')
    const res = await createCryptoDeposit(cookie, { amount: '10', cryptoAssetSymbol: symbol, networkCode })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Minimum deposit/)
    expect(await prisma.deposit.count({ where: { userId } })).toBe(0)
  })

  it('11b. no configured minimum allows any positive amount', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('nominimum')
    await createCryptoDeposit(cookie, { amount: '0.01', cryptoAssetSymbol: symbol, networkCode }).expect(201)
  })

  // ---- 12. Invalid amount rejected ------------------------------------------------

  it('12. zero/negative amounts are rejected for crypto deposits too', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('badamount')
    await createCryptoDeposit(cookie, { amount: '0', cryptoAssetSymbol: symbol, networkCode }).expect(400)
    await createCryptoDeposit(cookie, { amount: '-5', cryptoAssetSymbol: symbol, networkCode }).expect(400)
  })

  // ---- 13/26. Deposit creation snapshots the address ------------------------------

  it('13/26. a created deposit snapshots crypto asset, network, and the exact receiving address used', async () => {
    const { symbol, networkCode, network } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('snapshot')
    const res = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    expect(res.body.cryptoAssetSymbol).toBe(symbol)
    expect(res.body.networkCode).toBe(networkCode)
    expect(res.body.receivingAddress).toBe(network.receivingAddress)
    expect(res.body.currency).toBe(symbol)
  })

  // ---- 14/15. Address change safety — THE core Part 15 requirement ---------------

  it('14/15. changing the admin-configured address does NOT alter a historical deposit\'s snapshot, but a NEW deposit uses the new address', async () => {
    const { symbol, networkCode, asset } = await setupCryptoAsset({ address: TEST_ETH_ADDRESS_A })
    const { userId, cookie } = await registerAndLogin('addresschange')

    const first = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    expect(first.body.receivingAddress).toBe(TEST_ETH_ADDRESS_A)

    // Admin changes the address via the REAL step-up-gated endpoint.
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'address rotation test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    // The FIRST deposit's snapshot is untouched — re-read fresh from the DB.
    const firstReloaded = await prisma.deposit.findUniqueOrThrow({ where: { id: first.body.id } })
    expect(firstReloaded.receivingAddress).toBe(TEST_ETH_ADDRESS_A)

    // A brand-new deposit uses the NEW address.
    const second = await createCryptoDeposit(cookie, { amount: '50', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    expect(second.body.receivingAddress).toBe(TEST_ETH_ADDRESS_B)

    // The user's history shows both, each with its own historical address.
    const history = await request(server).get('/deposits/mine').set('Cookie', cookie).expect(200)
    const h1 = history.body.find((d: any) => d.id === first.body.id)
    const h2 = history.body.find((d: any) => d.id === second.body.id)
    expect(h1.receivingAddress).toBe(TEST_ETH_ADDRESS_A)
    expect(h2.receivingAddress).toBe(TEST_ETH_ADDRESS_B)
  })

  // ---- 16/17/18. Admin CRUD ---------------------------------------------------------

  it('16/17/18. admin can create, edit, and disable a crypto asset + receiving address configuration', async () => {
    const symbol = `ADMINCRUD${Date.now()}`
    await request(server)
      .post('/admin/crypto-deposits/assets')
      .set('Cookie', superCookie)
      .send({ symbol, name: 'Admin CRUD Test Asset' })
      .expect(201)

    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}`)
      .set('Cookie', superCookie)
      .send({ enabled: true })
      .expect(200)

    const created = await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', receivingAddress: TEST_ETH_ADDRESS_A, reason: 'initial setup', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
    expect(created.body.receivingAddress).toBe(TEST_ETH_ADDRESS_A)

    const edited = await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', receivingAddress: TEST_ETH_ADDRESS_B, reason: 'edit address', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
    expect(edited.body.receivingAddress).toBe(TEST_ETH_ADDRESS_B)

    const disabled = await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', receivingAddress: TEST_ETH_ADDRESS_B, enabled: false, reason: 'disable', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
    expect(disabled.body.enabled).toBe(false)
  })

  // ---- 19. Non-admin cannot change address ---------------------------------------

  it('19. a plain USER and a permission-less ADMIN cannot change any crypto deposit configuration', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('noauthcrypto')
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', cookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'unauthorized', confirmPassword: 'x', totpCode: '000000' })
      .expect(403)

    const email = uniqueEmail('cryptonoauth')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    const secret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) }).expect(200)
    const adminCookie = extractSessionCookie(verifyRes)
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', adminCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'no permission granted', confirmPassword: password, totpCode: currentTotpCode(secret) })
      .expect(403)
  })

  it('19b. step-up is genuinely required — wrong password rejects the address change', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'bad step-up', confirmPassword: 'totally-wrong-password', totpCode: currentTotpCode(superSecret) })
      .expect(401)
  })

  // ---- 19c. A SUPER_ADMIN without 2FA enabled — the exact scenario from the
  // "modal traps an admin with no way to satisfy it" bug report: this proves
  // the backend's own refusal is deliberate policy (a clear 400 explaining
  // 2FA must be enabled first), not a broken/misleading rejection, and that
  // it can never be bypassed by supplying an arbitrary 6-digit code — the
  // password is deliberately CORRECT here specifically to prove the block is
  // about the missing 2FA factor, not a coincidental wrong-password failure.
  it('19c. a SUPER_ADMIN with 2FA disabled is refused with a clear message (not a misleading "invalid code"), and the address is unchanged', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ address: TEST_ETH_ADDRESS_A })
    const email = uniqueEmail('cryptono2fa')
    const password = 'correct-horse-battery'
    await createUserDirect(prisma, { email, password, role: 'SUPER_ADMIN' })
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    expect(loginRes.body.needsTwoFactor).toBeUndefined() // confirms this fixture genuinely has no 2FA
    const noTwoFaCookie = extractSessionCookie(loginRes)

    const res = await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', noTwoFaCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'no 2fa enabled', confirmPassword: password, totpCode: '000000' })
      .expect(400)
    expect(res.body.message).toMatch(/two-factor authentication must be enabled/i)

    const asset = await prisma.cryptoAsset.findUniqueOrThrow({ where: { symbol }, include: { networks: true } })
    expect(asset.networks.find((n) => n.networkCode === networkCode)?.receivingAddress).toBe(TEST_ETH_ADDRESS_A)
  })

  // ---- 20. Audit event created for address changes ---------------------------------

  it('20. a receiving-address change writes an audit event carrying the previous and new address', async () => {
    const { symbol, networkCode } = await setupCryptoAsset({ address: TEST_ETH_ADDRESS_A })
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'audit trail test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const event = await prisma.auditLog.findFirst({ where: { action: 'CRYPTO_DEPOSIT_ADDRESS_CHANGED' }, orderBy: { createdAt: 'desc' } })
    expect(event).toBeTruthy()
    expect(event?.reason).toBe('audit trail test')
    expect((event?.newState as any)?.receivingAddress).toBe(TEST_ETH_ADDRESS_B)
    expect((event?.previousState as any)?.receivingAddress).toBe(TEST_ETH_ADDRESS_A)
  })

  // ---- 21/22/23. Ledger credit exactly once, idempotent, concurrent-safe ---------

  it('21/25. approving a crypto deposit credits the ledger exactly once, in the crypto asset\'s own currency', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { userId, cookie } = await registerAndLogin('approve')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    const created = await createCryptoDeposit(cookie, { amount: '100', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })
    const confirmed = await deposits.confirm(created.body.id, admin.id, 'approve test')
    expect(confirmed.status).toBe('CONFIRMED')

    const balances = await ledger.getAccountBalances(account.id, symbol)
    expect(balances.cash.toString()).toBe('100')

    const txns = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'DEPOSIT', relatedId: created.body.id }, include: { entries: true } })
    expect(txns).toHaveLength(1)
    for (const e of txns[0].entries) expect(e.currency).toBe(symbol)
  })

  it('22. duplicate approval (called twice) does not double-credit', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { userId, cookie } = await registerAndLogin('dupapprove')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })

    const created = await createCryptoDeposit(cookie, { amount: '75', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    await deposits.confirm(created.body.id, admin.id, 'first')
    await deposits.confirm(created.body.id, admin.id, 'second')
    await deposits.confirm(created.body.id, admin.id, 'third')

    const balances = await ledger.getAccountBalances(account.id, symbol)
    expect(balances.cash.toString()).toBe('75')
    const txnCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `deposit-confirm-${created.body.id}` } })
    expect(txnCount).toBe(1)
  })

  it('23. concurrent approval attempts result in exactly one financial effect', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { userId, cookie } = await registerAndLogin('concurrentapprove')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })

    const created = await createCryptoDeposit(cookie, { amount: '60', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    await Promise.all(Array.from({ length: 5 }).map(() => deposits.confirm(created.body.id, admin.id, 'concurrent')))

    const balances = await ledger.getAccountBalances(account.id, symbol)
    expect(balances.cash.toString()).toBe('60')
    const txnCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `deposit-confirm-${created.body.id}` } })
    expect(txnCount).toBe(1)
  })

  // ---- 24. Rejection does not credit the ledger ------------------------------------

  it('24. rejecting a crypto deposit never credits the ledger', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { userId, cookie } = await registerAndLogin('rejectcrypto')
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })

    const created = await createCryptoDeposit(cookie, { amount: '40', cryptoAssetSymbol: symbol, networkCode }).expect(201)
    const rejected = await deposits.reject(created.body.id, admin.id, 'not received on-chain')
    expect(rejected.status).toBe('FAILED')

    const balances = await ledger.getAccountBalances(account.id, symbol)
    expect(balances.cash.toString()).toBe('0')
    expect(await prisma.ledgerTransaction.count({ where: { relatedType: 'DEPOSIT', relatedId: created.body.id } })).toBe(0)
  })

  // ---- 27/28/29. Multiple assets, multiple networks, uniqueness -------------------

  it('27/28. multiple crypto assets and multiple networks per asset are all independently usable', async () => {
    const btc = await setupCryptoAsset({ networkCode: 'BTC', address: TEST_BTC_ADDRESS })
    const usdtTrc = await setupCryptoAsset({ symbol: `MULTI-USDT-${Date.now()}`, networkCode: 'TRC20', address: 'TJX9aKp7m3QrVb8sN2cWdFzL4hY6tRxEuP' })
    const usdtErc = await prisma.cryptoDepositAddress.create({
      data: { cryptoAssetId: usdtTrc.asset.id, networkCode: 'ERC20', networkName: 'ERC20', enabled: true, receivingAddress: TEST_ETH_ADDRESS_A },
    })

    const { cookie } = await registerAndLogin('multiasset')
    await createCryptoDeposit(cookie, { amount: '1', cryptoAssetSymbol: btc.symbol, networkCode: 'BTC' }).expect(201)
    await createCryptoDeposit(cookie, { amount: '10', cryptoAssetSymbol: usdtTrc.symbol, networkCode: 'TRC20' }).expect(201)
    await createCryptoDeposit(cookie, { amount: '10', cryptoAssetSymbol: usdtTrc.symbol, networkCode: 'ERC20' }).expect(201)
    expect(usdtErc.receivingAddress).toBe(TEST_ETH_ADDRESS_A)
  })

  it('29. asset+network uniqueness is enforced at the database level — upserting the same combination updates, never duplicates', async () => {
    const { symbol, networkCode, asset } = await setupCryptoAsset()
    await request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode, networkName: networkCode, receivingAddress: TEST_ETH_ADDRESS_B, reason: 'uniqueness test', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const count = await prisma.cryptoDepositAddress.count({ where: { cryptoAssetId: asset.id, networkCode } })
    expect(count).toBe(1)
  })

  // ---- 30. Missing address cannot create a deposit ---------------------------------

  it('30. a network with no receiving-address configuration at all cannot be used for a deposit', async () => {
    const { cookie } = await registerAndLogin('missingaddress')
    assetSeq += 1
    const symbol = `NOADDR${assetSeq}-${Date.now()}`
    await prisma.cryptoAsset.create({ data: { symbol, name: 'No Address Asset', enabled: true } })
    // No CryptoDepositAddress row created for any network.
    const res = await createCryptoDeposit(cookie, { amount: '10', cryptoAssetSymbol: symbol, networkCode: 'ERC20' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/NETWORK_DISABLED/)
  })

  // ---- 32. Upload proof behavior ----------------------------------------------------

  it('32. a user can upload a deposit proof, and both the depositor and an authorized admin can retrieve it — nobody else can', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { userId, cookie } = await registerAndLogin('proofupload')
    const created = await createCryptoDeposit(cookie, { amount: '20', cryptoAssetSymbol: symbol, networkCode }).expect(201)

    const uploadRes = await request(server)
      .post(`/deposits/${created.body.id}/proof`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), { filename: 'proof.png', contentType: 'image/png' })
    expect(uploadRes.status).toBe(201)
    expect(uploadRes.body.proofFilename).toBe('proof.png')

    await request(server).get(`/deposits/${created.body.id}/proof`).set('Cookie', cookie).expect(200)
    await request(server).get(`/admin/deposits/${created.body.id}/proof`).set('Cookie', superCookie).expect(200)

    const { cookie: otherCookie } = await registerAndLogin('proofintruder')
    await request(server).get(`/deposits/${created.body.id}/proof`).set('Cookie', otherCookie).expect(404)
  })

  // ---- Admin stats visibility (Part 27) ---------------------------------------------

  it('admin deposit listing includes crypto snapshot fields for review', async () => {
    const { symbol, networkCode } = await setupCryptoAsset()
    const { cookie } = await registerAndLogin('adminreview')
    const created = await createCryptoDeposit(cookie, { amount: '30', cryptoAssetSymbol: symbol, networkCode }).expect(201)

    const res = await request(server).get('/admin/deposits?status=PENDING').set('Cookie', superCookie).expect(200)
    const row = res.body.find((d: any) => d.id === created.body.id)
    expect(row).toBeTruthy()
    expect(row.cryptoAssetSymbol).toBe(symbol)
    expect(row.receivingAddress).toBeTruthy()
  })
})
