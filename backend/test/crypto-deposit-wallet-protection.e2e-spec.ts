import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// Protected production deposit wallets. The CMS ("Deposit Wallet" admin
// screen) stays fully editable, but in production a CUSTOMER is only ever
// given the hard-coded protected address for an (asset, network) — never the
// CMS row's address. These tests drive the real admin CMS routes to change
// the address, then hit the real customer routes directly (no frontend) with
// NODE_ENV set to production, exactly as the existing production-guardrail
// specs do.

// The five protected wallets, typed independently of the module under test.
const USDT_TRC20 = 'TY9jWFW7zPknZqT7T9x7SwiLLHfXNZXUpa'
const EVM = '0x4545e58dd75f65486fc9553277f76f178781bda2'
const BTC = '18chkuPvDEexJMmXXMtz7aExTL8FruU4jd'

// "Attacker" addresses an admin (or someone who compromised one) might type
// into the CMS — format-valid for each network so the CMS's own validator
// accepts them (they must be storable for the test to mean anything).
const ATTACKER_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const ATTACKER_EVM = '0x028693214AFA4E3bf4537175b5505315AFda80A3'
const ATTACKER_BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

const PROTECTED_CASES = [
  { label: 'USDT TRC20', symbol: 'USDT', networkCode: 'TRC20', name: 'Tether', protectedAddress: USDT_TRC20, attacker: ATTACKER_TRON },
  { label: 'USDT ERC20', symbol: 'USDT', networkCode: 'ERC20', name: 'Tether', protectedAddress: EVM, attacker: ATTACKER_EVM },
  { label: 'BTC', symbol: 'BTC', networkCode: 'BTC', name: 'Bitcoin', protectedAddress: BTC, attacker: ATTACKER_BTC },
  { label: 'ETH', symbol: 'ETH', networkCode: 'ETH', name: 'Ethereum', protectedAddress: EVM, attacker: ATTACKER_EVM },
  { label: 'BNB (BNB Smart Chain)', symbol: 'BNB', networkCode: 'BEP20', name: 'BNB', protectedAddress: EVM, attacker: ATTACKER_EVM },
] as const

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('Protected production deposit wallets (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any
  let superCookie: string
  let superPassword: string
  let superAdminId: string
  let customer: { userId: string; cookie: string }

  // Snapshot of everything this spec touches, restored afterwards so a shared
  // disposable database is left as other specs expect it.
  const touched = new Map<string, { existedBefore: boolean; assetEnabled?: boolean; networks: { networkCode: string; networkName: string; receivingAddress: string; enabled: boolean; qrStorageKey: string | null }[] }>()
  const SYMBOLS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL']

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()

    const email = uniqueEmail('walletprotectsuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superAdminId = user.id
    const secret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)

    const cEmail = uniqueEmail('walletprotectcust')
    const { user: cUser } = await createUserDirect(prisma, { email: cEmail, password: 'correct-horse-battery', fullName: 'Wallet Protect Customer' })
    const cLogin = await request(server).post('/auth/login').send({ email: cEmail, password: 'correct-horse-battery' }).expect(200)
    customer = { userId: cUser.id, cookie: extractSessionCookie(cLogin) }

    for (const symbol of SYMBOLS) {
      const asset = await prisma.cryptoAsset.findUnique({ where: { symbol }, include: { networks: true } })
      touched.set(symbol, {
        existedBefore: !!asset,
        assetEnabled: asset?.enabled,
        networks: (asset?.networks ?? []).map((n) => ({ networkCode: n.networkCode, networkName: n.networkName, receivingAddress: n.receivingAddress, enabled: n.enabled, qrStorageKey: n.qrStorageKey })),
      })
    }
  })

  afterAll(async () => {
    for (const [symbol, before] of touched) {
      const asset = await prisma.cryptoAsset.findUnique({ where: { symbol } })
      if (!asset) continue
      if (!before.existedBefore) { await prisma.cryptoAsset.delete({ where: { id: asset.id } }); continue }
      await prisma.cryptoDepositAddress.deleteMany({ where: { cryptoAssetId: asset.id } })
      for (const n of before.networks) await prisma.cryptoDepositAddress.create({ data: { cryptoAssetId: asset.id, ...n } })
      await prisma.cryptoAsset.update({ where: { id: asset.id }, data: { enabled: before.assetEnabled ?? false } })
    }
    await app.close()
  })

  // Runs `fn` as the production environment does. NODE_ENV is only read at
  // call time by the protection, so flipping it around the HTTP calls (after
  // login) simulates a production server without restarting the app.
  async function inEnv<T>(env: string | undefined, fn: () => Promise<T>): Promise<T> {
    const original = process.env.NODE_ENV
    try {
      if (env === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = env
      return await fn()
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  }
  const inProduction = <T>(fn: () => Promise<T>) => inEnv('production', fn)

  async function enableAsset(symbol: string, name: string) {
    await prisma.cryptoAsset.upsert({ where: { symbol }, create: { symbol, name, enabled: true }, update: { enabled: true } })
  }

  // The REAL CMS path: admin route, step-up password, validator, audit.
  function cmsSetAddress(symbol: string, networkCode: string, address: string, extra: { enabled?: boolean; networkName?: string; reason?: string } = {}) {
    return request(server)
      .patch(`/admin/crypto-deposits/assets/${symbol}/networks`)
      .set('Cookie', superCookie)
      .send({ networkCode, networkName: extra.networkName ?? networkCode, receivingAddress: address, enabled: extra.enabled ?? true, reason: extra.reason ?? 'wallet protection e2e', confirmPassword: superPassword })
  }

  const customerResolve = (symbol: string, networkCode: string) => request(server).get(`/crypto-deposits/assets/${symbol}/networks/${networkCode}`).set('Cookie', customer.cookie)
  const customerDeposit = (body: Record<string, unknown>) => request(server).post('/deposits').set('Cookie', customer.cookie).send({ method: 'CRYPTO', amount: '10', ...body })

  // ---- TEST 1 + 2 — every protected asset/network --------------------------------

  describe.each(PROTECTED_CASES)('$label', ({ symbol, networkCode, name, protectedAddress, attacker }) => {
    it('CMS edit is accepted, stored and shown to admins as-is, yet the customer-facing address stays the protected one', async () => {
      await enableAsset(symbol, name)
      const first = await cmsSetAddress(symbol, networkCode, attacker).expect(200)
      expect(first.body.receivingAddress).toBe(attacker) // the CMS accepted and stored the changed address

      // The admin CMS view still shows the changed address (nothing hidden from admins).
      const adminView = await request(server).get('/admin/crypto-deposits/assets').set('Cookie', superCookie).expect(200)
      const row = adminView.body.find((a: any) => a.symbol === symbol).networks.find((n: any) => n.networkCode === networkCode)
      expect(row.receivingAddress).toBe(attacker)
      expect(row.enabled).toBe(true)

      await inProduction(async () => {
        const res = await customerResolve(symbol, networkCode).expect(200)
        expect(res.body.receivingAddress).toBe(protectedAddress)
        expect(res.body.receivingAddress).not.toBe(attacker)
        expect(res.body.symbol).toBe(symbol)
        expect(res.body.networkCode).toBe(networkCode)
      })
    })

    it('a deposit created in production snapshots the protected address (response, database row and history all agree)', async () => {
      await enableAsset(symbol, name)
      await cmsSetAddress(symbol, networkCode, attacker).expect(200)

      await inProduction(async () => {
        const created = await customerDeposit({ cryptoAssetSymbol: symbol, networkCode }).expect(201)
        expect(created.body.receivingAddress).toBe(protectedAddress)
        const stored = await prisma.deposit.findUniqueOrThrow({ where: { id: created.body.id } })
        expect(stored.receivingAddress).toBe(protectedAddress)
        expect(stored.receivingAddress).not.toBe(attacker)
        expect(stored.networkCode).toBe(networkCode)
        const history = await request(server).get('/deposits/mine').set('Cookie', customer.cookie).expect(200)
        expect(history.body.find((d: any) => d.id === created.body.id).receivingAddress).toBe(protectedAddress)
      })
    })

    it('a lower-case / re-cased network code in the URL resolves to the same protected address', async () => {
      await enableAsset(symbol, name)
      await cmsSetAddress(symbol, networkCode, attacker).expect(200)
      await inProduction(async () => {
        const res = await customerResolve(symbol, networkCode.toLowerCase()).expect(200)
        expect(res.body.receivingAddress).toBe(protectedAddress)
      })
    })
  })

  // ---- TEST 3 — bypassing the frontend, calling the API directly --------------------

  describe('calling the backend directly, without the frontend', () => {
    it('cannot be talked into another address: extra body fields / query parameters are ignored or rejected, never stored', async () => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)

      await inProduction(async () => {
        const injected = await customerDeposit({ cryptoAssetSymbol: 'USDT', networkCode: 'TRC20', receivingAddress: ATTACKER_TRON, address: ATTACKER_TRON, walletAddress: ATTACKER_TRON })
        if (injected.status === 201) {
          expect(injected.body.receivingAddress).toBe(USDT_TRC20)
          expect((await prisma.deposit.findUniqueOrThrow({ where: { id: injected.body.id } })).receivingAddress).toBe(USDT_TRC20)
        } else {
          expect(injected.status).toBe(400) // strict validation refuses unknown fields — equally safe
        }

        const withQuery = await request(server).get('/crypto-deposits/assets/USDT/networks/TRC20').query({ receivingAddress: ATTACKER_TRON, address: ATTACKER_TRON }).set('Cookie', customer.cookie).expect(200)
        expect(withQuery.body.receivingAddress).toBe(USDT_TRC20)
      })
    })

    it('the general asset list never carries an address, so it cannot leak a CMS one either', async () => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)
      await inProduction(async () => {
        const list = await request(server).get('/crypto-deposits/assets').set('Cookie', customer.cookie).expect(200)
        const json = JSON.stringify(list.body)
        expect(json).not.toContain(ATTACKER_TRON)
        expect(json).not.toContain(USDT_TRC20)
        expect(list.body.find((a: any) => a.symbol === 'USDT').networks.some((n: any) => n.networkCode === 'TRC20')).toBe(true)
      })
    })

    it('requires a session — an unauthenticated caller gets no address at all', async () => {
      await inProduction(async () => {
        await request(server).get('/crypto-deposits/assets/USDT/networks/TRC20').expect(401)
        await request(server).post('/deposits').send({ method: 'CRYPTO', amount: '10', cryptoAssetSymbol: 'USDT', networkCode: 'TRC20' }).expect(401)
      })
    })
  })

  // ---- Pairs with no protected wallet fail closed --------------------------------------

  describe('a (asset, network) pair with no protected wallet is never served from the CMS', () => {
    it('a network an admin adds is not offered, resolvable, or depositable in production — but the CMS still stores and shows it', async () => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)
      await cmsSetAddress('USDT', 'BEP20', ATTACKER_EVM, { networkName: 'BNB Smart Chain (BEP20)' }).expect(200) // e.g. an attacker adds a new network
      await enableAsset('SOL', 'Solana')
      await cmsSetAddress('SOL', 'SOL', '4Nd1mYQzvV7v7Z3WJ9tD2Zk6qXo5hQfTt3nJp9c7YQxS').expect(200)

      const adminView = await request(server).get('/admin/crypto-deposits/assets').set('Cookie', superCookie).expect(200)
      expect(adminView.body.find((a: any) => a.symbol === 'USDT').networks.map((n: any) => n.networkCode)).toEqual(expect.arrayContaining(['TRC20', 'BEP20']))
      expect(adminView.body.find((a: any) => a.symbol === 'SOL').networks[0].receivingAddress).toBe('4Nd1mYQzvV7v7Z3WJ9tD2Zk6qXo5hQfTt3nJp9c7YQxS')

      await inProduction(async () => {
        const list = await request(server).get('/crypto-deposits/assets').set('Cookie', customer.cookie).expect(200)
        const usdtCodes = list.body.find((a: any) => a.symbol === 'USDT').networks.map((n: any) => n.networkCode)
        expect(usdtCodes).toContain('TRC20') // protected pair: offered
        expect(usdtCodes).not.toContain('BEP20') // the attacker-added network: not offered
        expect(usdtCodes.every((c: string) => ['TRC20', 'ERC20'].includes(c))).toBe(true) // only ever protected networks
        expect(list.body.find((a: any) => a.symbol === 'SOL')).toBeUndefined() // an asset with nothing protected disappears entirely

        await customerResolve('USDT', 'BEP20').expect(400)
        await customerResolve('SOL', 'SOL').expect(400)

        const before = await prisma.deposit.count({ where: { userId: customer.userId } })
        await customerDeposit({ cryptoAssetSymbol: 'USDT', networkCode: 'BEP20' }).expect(400)
        await customerDeposit({ cryptoAssetSymbol: 'SOL', networkCode: 'SOL' }).expect(400)
        expect(await prisma.deposit.count({ where: { userId: customer.userId } })).toBe(before) // nothing was created
      })
    })

    it('a protected pair still needs the CMS to have it switched on — disabling it there stops customers, but never changes the address', async () => {
      await enableAsset('BTC', 'Bitcoin')
      await cmsSetAddress('BTC', 'BTC', ATTACKER_BTC, { enabled: false }).expect(200)
      await inProduction(async () => {
        await customerResolve('BTC', 'BTC').expect(400)
        await customerDeposit({ cryptoAssetSymbol: 'BTC', networkCode: 'BTC' }).expect(400)
      })
      await cmsSetAddress('BTC', 'BTC', ATTACKER_BTC, { enabled: true }).expect(200)
      await inProduction(async () => {
        expect((await customerResolve('BTC', 'BTC').expect(200)).body.receivingAddress).toBe(BTC)
      })
    })

    it('the network is part of the wallet: a network row labelled as TRC20 on another asset, or a mislabelled code, never borrows a different network\'s address', async () => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)
      await cmsSetAddress('USDT', 'ERC20', ATTACKER_EVM).expect(200)
      await inProduction(async () => {
        expect((await customerResolve('USDT', 'TRC20').expect(200)).body.receivingAddress).toBe(USDT_TRC20)
        expect((await customerResolve('USDT', 'ERC20').expect(200)).body.receivingAddress).toBe(EVM)
        expect((await customerResolve('USDT', 'TRC20').expect(200)).body.receivingAddress).not.toBe(EVM)
        expect((await customerResolve('USDT', 'ERC20').expect(200)).body.receivingAddress).not.toBe(USDT_TRC20)
      })
    })
  })

  // ---- Uploaded-QR route (CMS content) -------------------------------------------------

  describe('the admin-uploaded QR image', () => {
    async function uploadCmsQr() {
      await enableAsset('USDT', 'Tether')
      await request(server)
        .patch('/admin/crypto-deposits/assets/USDT/networks')
        .set('Cookie', superCookie)
        .field('networkCode', 'TRC20').field('networkName', 'Tron (TRC20)').field('receivingAddress', ATTACKER_TRON)
        .field('reason', 'upload qr e2e').field('confirmPassword', superPassword)
        .attach('qr', PNG_BYTES, { filename: 'qr.png', contentType: 'image/png' })
        .expect(200)
    }

    it('production: customers can no longer fetch a CMS-uploaded QR (the customer page draws its own QR from the protected address), and the response is indistinguishable from "none uploaded"', async () => {
      await uploadCmsQr()
      await inProduction(async () => {
        const res = await request(server).get('/crypto-deposits/assets/USDT/networks/TRC20/qr').set('Cookie', customer.cookie)
        expect(res.status).toBe(404)
        expect(res.body.message).toBe('No QR code uploaded for this network.')
      })
    })

    it('production: admins still see the uploaded QR in the CMS exactly as before (CMS behavior unchanged)', async () => {
      await uploadCmsQr()
      await inProduction(async () => {
        const res = await request(server).get('/crypto-deposits/assets/USDT/networks/TRC20/qr').set('Cookie', superCookie).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = []
          r.on('data', (c: Buffer) => chunks.push(c))
          r.on('end', () => cb(null, Buffer.concat(chunks)))
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('image/png')
        expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0)
      })
      const adminView = await request(server).get('/admin/crypto-deposits/assets').set('Cookie', superCookie).expect(200)
      expect(adminView.body.find((a: any) => a.symbol === 'USDT').networks.find((n: any) => n.networkCode === 'TRC20').hasQr).toBe(true)
    })

    it('development/test: unchanged — the route still serves the uploaded image to any signed-in user', async () => {
      await uploadCmsQr()
      const res = await request(server).get('/crypto-deposits/assets/USDT/networks/TRC20/qr').set('Cookie', customer.cookie)
      expect(res.status).toBe(200)
    })
  })

  // ---- TEST 5 — CMS audit / history intact -----------------------------------------------

  describe('CMS audit and history behavior is intact', () => {
    it('a CMS address change still writes an audit event with the actor, reason and both addresses', async () => {
      await enableAsset('ETH', 'Ethereum')
      await cmsSetAddress('ETH', 'ETH', ATTACKER_EVM, { reason: 'baseline' }).expect(200)
      const second = await cmsSetAddress('ETH', 'ETH', '0x054b4d2b3ff0aaecb688df5f735dfc4dc4b8695e', { reason: 'audit trail under protection' }).expect(200)

      const events = await prisma.auditLog.findMany({ where: { action: 'CRYPTO_DEPOSIT_ADDRESS_CHANGED', targetId: second.body.id }, orderBy: { createdAt: 'desc' } })
      const latest = events[0]
      expect(latest.actorId).toBe(superAdminId)
      expect(latest.reason).toBe('audit trail under protection')
      expect((latest.previousState as any).receivingAddress).toBe(ATTACKER_EVM)
      expect((latest.newState as any).receivingAddress).toBe('0x054b4d2b3ff0aaecb688df5f735dfc4dc4b8695e')
    })

    it('a CMS change still requires the admin\'s step-up password, and a customer cannot use the CMS route at all', async () => {
      await enableAsset('ETH', 'Ethereum')
      const wrong = await request(server).patch('/admin/crypto-deposits/assets/ETH/networks').set('Cookie', superCookie)
        .send({ networkCode: 'ETH', networkName: 'ETH', receivingAddress: ATTACKER_EVM, reason: 'bad step-up', confirmPassword: 'definitely-wrong' })
      expect(wrong.status).not.toBe(200)
      const asCustomer = await request(server).patch('/admin/crypto-deposits/assets/ETH/networks').set('Cookie', customer.cookie)
        .send({ networkCode: 'ETH', networkName: 'ETH', receivingAddress: ATTACKER_EVM, reason: 'nope', confirmPassword: 'x' })
      expect(asCustomer.status).toBe(403)
    })

    it('a deposit created BEFORE protection keeps its own historical snapshot — protection only affects new deposits', async () => {
      await enableAsset('BTC', 'Bitcoin')
      await cmsSetAddress('BTC', 'BTC', ATTACKER_BTC).expect(200)
      const legacy = await customerDeposit({ cryptoAssetSymbol: 'BTC', networkCode: 'BTC' }).expect(201) // NODE_ENV=test: CMS-served, as before
      expect(legacy.body.receivingAddress).toBe(ATTACKER_BTC)
      await inProduction(async () => {
        const fresh = await customerDeposit({ cryptoAssetSymbol: 'BTC', networkCode: 'BTC' }).expect(201)
        expect(fresh.body.receivingAddress).toBe(BTC)
        expect((await prisma.deposit.findUniqueOrThrow({ where: { id: legacy.body.id } })).receivingAddress).toBe(ATTACKER_BTC) // untouched
      })
    })
  })

  // ---- Environment scoping ------------------------------------------------------------

  describe('environment scoping', () => {
    it('development/test still serve the CMS address (local work and the existing suite are unchanged)', async () => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)
      expect((await customerResolve('USDT', 'TRC20').expect(200)).body.receivingAddress).toBe(ATTACKER_TRON)
      await inEnv('development', async () => {
        expect((await customerResolve('USDT', 'TRC20').expect(200)).body.receivingAddress).toBe(ATTACKER_TRON)
      })
    })

    it.each(['production', 'staging', 'something-unexpected', undefined])('NODE_ENV=%s is protected (fail closed)', async (env) => {
      await enableAsset('USDT', 'Tether')
      await cmsSetAddress('USDT', 'TRC20', ATTACKER_TRON).expect(200)
      await inEnv(env, async () => {
        expect((await customerResolve('USDT', 'TRC20').expect(200)).body.receivingAddress).toBe(USDT_TRC20)
      })
    })
  })
})
