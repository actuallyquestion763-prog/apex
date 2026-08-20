// Seeds non-identity, non-credential platform data only: permission
// definitions, the platform settings singleton, and default per-market
// config rows. Safe to re-run in any environment — every step is
// idempotent (upsert).
//
// This script does NOT create any user account, and never has a password
// or credential of any kind. The first SUPER_ADMIN is created exclusively
// via `npm run admin:create-superadmin` (scripts/create-superadmin.ts), an
// interactive-only bootstrap that never reads a credential from the
// environment, a file, or a CLI argument — see that script for why.
import 'dotenv/config'
import { PrismaClient, MarketDataSource } from '@prisma/client'
import { PERMISSIONS } from '../src/common/permissions'

const prisma = new PrismaClient()

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'users.read': 'View user accounts',
  'users.write': 'Change user status',
  'kyc.read': 'View KYC verification queue',
  'kyc.review': 'Approve or reject KYC verifications',
  'deposits.read': 'View deposits',
  'deposits.review': 'Confirm or reject deposits',
  'crypto_deposits.read': 'View crypto deposit asset/network/receiving-address configuration',
  'crypto_deposits.control': 'Manage crypto deposit assets, networks, and receiving addresses',
  'withdrawals.read': 'View withdrawals',
  'withdrawals.review': 'Approve or reject withdrawals',
  'trading.read': 'View trading activity',
  'trading.control': 'Pause/resume trading platform-wide',
  'markets.read': 'View per-market configuration',
  'markets.control': 'Change per-market configuration',
  'options.read': 'View options-trading configuration, statistics, and unresolved trades',
  'options.control': 'Change options-trading configuration (assets, durations, payouts, platform-wide kill switch)',
  'ledger.read': 'View ledger transactions and balances',
  'ledger.adjust': 'Create financial adjustments',
  'audit.read': 'View the audit log',
  'platform.read': 'View the platform overview',
  'platform.control': 'Change platform-wide kill switches',
  'admins.read': 'View administrator accounts and their permissions',
  'admins.manage': 'Grant or revoke administrator permissions',

  'cms.pages.read': 'View CMS pages (including drafts)',
  'cms.pages.create': 'Create CMS pages',
  'cms.pages.update': 'Edit CMS pages',
  'cms.pages.publish': 'Publish or unpublish CMS pages',
  'cms.pages.archive': 'Archive CMS pages',
  'cms.announcements.read': 'View announcements (including drafts)',
  'cms.announcements.create': 'Create announcements',
  'cms.announcements.update': 'Edit announcements',
  'cms.announcements.publish': 'Publish or unpublish announcements',
  'cms.announcements.archive': 'Archive announcements',
  'cms.faqs.read': 'View FAQs (including drafts)',
  'cms.faqs.create': 'Create FAQs',
  'cms.faqs.update': 'Edit FAQs',
  'cms.faqs.publish': 'Publish FAQs',
  'cms.faqs.archive': 'Archive FAQs',
  'cms.media.read': 'View uploaded media',
  'cms.media.upload': 'Upload media',
  'cms.media.delete': 'Delete media',
  'cms.navigation.read': 'View CMS-managed navigation',
  'cms.navigation.update': 'Create or edit CMS-managed navigation items',

  'support.tickets.read': 'View support tickets',
  'support.tickets.create': 'Create a support ticket on behalf of a customer (reserved for future use)',
  'support.tickets.assign': 'Assign support tickets to an agent',
  'support.tickets.update': 'Change support ticket status/priority',
  'support.tickets.reply': 'Reply to a customer on a support ticket',
  'support.tickets.internal_note': 'Write staff-only internal notes on a support ticket',
  'support.tickets.resolve': 'Mark a support ticket resolved',
  'support.tickets.close': 'Close a support ticket',
  'support.categories.manage': 'Create, rename, or (de)activate support categories',
}

const DEFAULT_SUPPORT_CATEGORIES = [
  'Account', 'Login', 'KYC', 'Deposit', 'Withdrawal', 'Trading', 'Technical Issue', 'Security', 'General',
]

// ---------------------------------------------------------------------------
// CMS starter content (Phase 4) — makes the CMS the actual source of truth
// for the public site instead of shipping with an empty CMS next to
// hardcoded frontend copy. Reuses the EXACT existing marketing copy from
// LandingPage.tsx (this is not fabricated placeholder content pretending to
// be real) for the homepage/FAQ; the About/Contact/Help/Terms/Privacy/Risk
// pages are new, but explicitly and honestly labeled as fictional-demo
// content, consistent with the platform's existing "no real funds" framing.
//
// Every write here is upsert-or-skip-if-present — safe to re-run, and never
// overwrites content an admin has since edited through the CMS UI (an
// existing row's `update` is always `{}`).
//
// CmsPage/CmsFaq/CmsNavigationItem all require a createdByAdminId FK. This
// script deliberately never creates a user account (see the file header) —
// if no admin exists yet (a truly fresh environment, before
// `npm run admin:create-superadmin` has ever been run), CMS seeding is
// skipped entirely rather than fabricating an actor. Re-run `npm run seed`
// after creating the first admin to populate this content.
async function seedCmsContent() {
  const admin = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.log('No admin account exists yet — skipping CMS starter content. Run `npm run admin:create-superadmin`, then `npm run seed` again to populate the public site.')
    return
  }

  const homepageSections = [
    { type: 'hero', fields: { badge: 'Registered · ISO 27001 Certified', title: 'Trade crypto with confidence', subtitle: 'The institutional-grade trading platform. Deep liquidity, 100x leverage, and bank-grade security — all in one elegant interface.', ctaLabel: 'Open free account', ctaHref: '/signup' } },
    { type: 'stats', fields: { stat1: '2.4M+ traders', stat2: '$18B+ volume', stat3: '140+ countries' } },
    { type: 'feature', fields: { title: 'Instant execution', desc: 'Sub-millisecond order matching with deep liquidity pools.' } },
    { type: 'feature', fields: { title: 'Pro charts', desc: 'Real-time candlestick charts with 1m, 5m, and 1h timeframes.' } },
    { type: 'feature', fields: { title: 'Bank-grade security', desc: 'Cold storage, 2FA, and withdrawal whitelisting keep your funds safe.' } },
    { type: 'feature', fields: { title: 'Low fees', desc: '0.1% per trade. Volume discounts available.' } },
    { type: 'trust', fields: { badge1: 'Regulated', badge2: 'ISO 27001' } },
    { type: 'cta', fields: { title: 'Ready to start trading?', subtitle: 'Join 2.4 million traders. Open your free account in seconds.', ctaLabel: 'Create free account', ctaHref: '/signup' } },
    { type: 'footer', fields: { tagline: 'The institutional-grade crypto trading platform. Trade with confidence.' } },
  ]

  const PAGES: { slug: string; title: string; body: string }[] = [
    { slug: 'about', title: 'About TRUST', body: 'TRUST is a fictional demonstration trading platform built to showcase a modern, secure trading experience. This is a foundation/demo environment — no real funds, no real broker or exchange, and no real payment provider are connected. Every balance, deposit, and trade you see here exists only within this demo.' },
    { slug: 'contact', title: 'Contact us', body: 'For help with your account, open a support ticket from your dashboard and our team will respond there. This demo does not have a live phone line or a monitored public email address — all support communication happens through the in-app Support system.' },
    { slug: 'help', title: 'Help center', body: 'Looking for answers? Check the Frequently Asked Questions on the homepage first. For anything specific to your account, deposits, withdrawals, or verification, open a support ticket from your dashboard and a member of our team will follow up there.' },
    { slug: 'terms', title: 'Terms of Service', body: 'This is placeholder Terms of Service text for TRUST, a fictional demonstration platform, and does not constitute a real legal agreement. In a production deployment this page would be replaced with actual, jurisdiction-appropriate terms reviewed by legal counsel before any real user funds were involved.' },
    { slug: 'privacy', title: 'Privacy Policy', body: 'This is placeholder Privacy Policy text for TRUST, a fictional demonstration platform, and does not constitute a real privacy policy. In a production deployment this page would describe what data is actually collected, how it is stored, and a user’s real rights over it, reviewed by legal counsel.' },
    { slug: 'risk-disclosure', title: 'Risk Disclosure', body: 'This is placeholder risk-disclosure text for TRUST, a fictional demonstration platform. Trading real crypto assets carries substantial risk of loss and is not suitable for every investor. No real funds are involved anywhere on this demo platform, and nothing here is real financial advice.' },
  ]

  const FAQS: { question: string; answer: string; order: number }[] = [
    { question: 'Is TRUST a regulated platform?', answer: 'TRUST is registered with the fictional Digital Asset Authority and complies with international AML/KYC standards. Client funds are held in segregated cold-storage wallets.', order: 0 },
    { question: 'How long do deposits take?', answer: 'USDT deposits confirm within 10–30 minutes on the TRC-20 network. Bank transfers take 1–3 business days, and card deposits are instant.', order: 1 },
    { question: 'What are the trading fees?', answer: 'Trading fees start at 0.1% per transaction. Fees decrease with higher trading volume.', order: 2 },
    { question: 'How much starting balance do I get?', answer: 'New accounts start at $0 — deposit funds to fund your account, or ask an administrator about a demo credit for exploring the platform.', order: 3 },
    { question: 'How does the referral program work?', answer: 'Share your unique referral link. You earn 10% commission on every trade made by users you refer, credited in real time to your balance.', order: 4 },
    { question: 'How do I open a position?', answer: 'Pick a market on the Trade page, enter your amount, and choose Buy or Sell. Your position updates in real time with the live market price until you close it.', order: 5 },
  ]

  const NAV_ITEMS: { label: string; destination: string; order: number }[] = [
    { label: 'About', destination: '/pages/about', order: 0 },
    { label: 'Help', destination: '/pages/help', order: 1 },
    { label: 'Contact', destination: '/pages/contact', order: 2 },
    { label: 'Terms', destination: '/pages/terms', order: 3 },
    { label: 'Privacy', destination: '/pages/privacy', order: 4 },
    { label: 'Risk Disclosure', destination: '/pages/risk-disclosure', order: 5 },
  ]

  await prisma.cmsPage.upsert({
    where: { slug: 'homepage' },
    create: { slug: 'homepage', title: 'Homepage', sections: homepageSections, status: 'PUBLISHED', publishedAt: new Date(), createdByAdminId: admin.id },
    update: {},
  })

  for (const p of PAGES) {
    await prisma.cmsPage.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, title: p.title, sections: [{ type: 'text', fields: { body: p.body } }], status: 'PUBLISHED', publishedAt: new Date(), createdByAdminId: admin.id },
      update: {},
    })
  }

  for (const f of FAQS) {
    const existing = await prisma.cmsFaq.findFirst({ where: { question: f.question } })
    if (!existing) {
      await prisma.cmsFaq.create({ data: { question: f.question, answer: f.answer, category: 'General', order: f.order, status: 'PUBLISHED', createdByAdminId: admin.id } })
    }
  }

  for (const n of NAV_ITEMS) {
    const existing = await prisma.cmsNavigationItem.findFirst({ where: { label: n.label } })
    if (!existing) {
      await prisma.cmsNavigationItem.create({ data: { label: n.label, destination: n.destination, order: n.order } })
    }
  }

  console.log(`Seeded CMS starter content (homepage + ${PAGES.length} pages + ${FAQS.length} FAQs + ${NAV_ITEMS.length} nav items), attributed to admin ${admin.email}.`)
}

async function main() {
  await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  })

  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, description: PERMISSION_DESCRIPTIONS[key] ?? key },
      update: { description: PERMISSION_DESCRIPTIONS[key] ?? key },
    })
  }
  console.log(`Seeded ${PERMISSIONS.length} permission definitions (none granted to any ADMIN by default).`)

  // Phase 6C: all 8 crypto pairs upgraded from provider: SIMULATED to
  // provider: BINANCE — each individually verified against live Binance
  // Spot exchangeInfo this phase (status: TRADING, isSpotTradingAllowed:
  // true, correct base/quote asset — see the Phase 6C report's Part 4 for
  // the verification record). providerSymbol/pricePrecision/
  // quantityPrecision below are the ACTUAL values read from Binance's
  // PRICE_FILTER.tickSize / LOT_SIZE.stepSize for each symbol, not
  // estimated. dataSource flips to LIVE alongside provider — this is safe
  // to do independently of tradingEnabled (which stays false — Part 6/24:
  // trading is never auto-enabled just because data is live; see
  // OrdersService, whose very first check is tradingEnabled, before it
  // ever looks at dataSource). XAU/USD (GoldAPI) is unchanged.
  const markets: {
    symbol: string; dataSource: MarketDataSource; tradingEnabled: boolean
    baseAsset: string; quoteAsset: string; displayName: string
    marketType: 'CRYPTO_SPOT' | 'CFD'; pricePrecision: number; quantityPrecision: number
    provider: string; providerSymbol: string
  }[] = [
    { symbol: 'XAU/USD', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'XAU', quoteAsset: 'USD', displayName: 'Gold', marketType: 'CFD', pricePrecision: 2, quantityPrecision: 8, provider: 'GOLDAPI', providerSymbol: 'XAU/USD' },
    { symbol: 'BTC/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'BTC', quoteAsset: 'USDT', displayName: 'Bitcoin', marketType: 'CRYPTO_SPOT', pricePrecision: 2, quantityPrecision: 5, provider: 'BINANCE', providerSymbol: 'BTCUSDT' },
    { symbol: 'ETH/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'ETH', quoteAsset: 'USDT', displayName: 'Ethereum', marketType: 'CRYPTO_SPOT', pricePrecision: 2, quantityPrecision: 4, provider: 'BINANCE', providerSymbol: 'ETHUSDT' },
    { symbol: 'USDT/USD', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'USDT', quoteAsset: 'USD', displayName: 'Tether', marketType: 'CRYPTO_SPOT', pricePrecision: 5, quantityPrecision: 0, provider: 'BINANCE', providerSymbol: 'USDTUSD' },
    { symbol: 'XRP/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'XRP', quoteAsset: 'USDT', displayName: 'Ripple', marketType: 'CRYPTO_SPOT', pricePrecision: 4, quantityPrecision: 1, provider: 'BINANCE', providerSymbol: 'XRPUSDT' },
    { symbol: 'SOL/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'SOL', quoteAsset: 'USDT', displayName: 'Solana', marketType: 'CRYPTO_SPOT', pricePrecision: 2, quantityPrecision: 3, provider: 'BINANCE', providerSymbol: 'SOLUSDT' },
    { symbol: 'BNB/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'BNB', quoteAsset: 'USDT', displayName: 'BNB', marketType: 'CRYPTO_SPOT', pricePrecision: 2, quantityPrecision: 3, provider: 'BINANCE', providerSymbol: 'BNBUSDT' },
    { symbol: 'ADA/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'ADA', quoteAsset: 'USDT', displayName: 'Cardano', marketType: 'CRYPTO_SPOT', pricePrecision: 4, quantityPrecision: 1, provider: 'BINANCE', providerSymbol: 'ADAUSDT' },
    { symbol: 'DOGE/USDT', dataSource: MarketDataSource.LIVE, tradingEnabled: false, baseAsset: 'DOGE', quoteAsset: 'USDT', displayName: 'Dogecoin', marketType: 'CRYPTO_SPOT', pricePrecision: 5, quantityPrecision: 0, provider: 'BINANCE', providerSymbol: 'DOGEUSDT' },
  ]
  for (const m of markets) {
    const { symbol, ...rest } = m
    await prisma.marketConfig.upsert({
      where: { symbol },
      create: { symbol, ...rest, enabled: true },
      update: { ...rest },
    })
  }

  // Fixed-Time Options Trading — a separate product from spot. Platform-wide
  // tradingEnabled stays FALSE by default (a brand-new financial product
  // must never silently go live the moment this migration runs — see
  // OptionsSettingsService). The two example OptionMarket rows below ARE
  // seeded `enabled: true` so the feature is demonstrable locally, exactly
  // mirroring how spot's own MarketConfig rows are seeded with dataSource
  // LIVE + listed (enabled: true) while tradingEnabled stays false until an
  // admin explicitly turns trading on — "data ready, trading gated" is the
  // established pattern this repeats, not a new one.
  await prisma.optionsSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  })

  const OPTION_MARKETS: { symbol: string; currency: string; minInvestment: string; maxInvestment: string; durations: { durationSeconds: number; payoutPercent: string }[] }[] = [
    {
      symbol: 'XAU/USD', currency: 'USDT', minInvestment: '1', maxInvestment: '1000',
      durations: [
        { durationSeconds: 30, payoutPercent: '5' },
        { durationSeconds: 60, payoutPercent: '7' },
        { durationSeconds: 90, payoutPercent: '9' },
        { durationSeconds: 120, payoutPercent: '12' },
        { durationSeconds: 180, payoutPercent: '15' },
      ],
    },
    {
      symbol: 'BTC/USDT', currency: 'USDT', minInvestment: '1', maxInvestment: '1000',
      durations: [
        { durationSeconds: 30, payoutPercent: '5' },
        { durationSeconds: 60, payoutPercent: '7' },
        { durationSeconds: 120, payoutPercent: '12' },
        { durationSeconds: 180, payoutPercent: '15' },
      ],
    },
  ]
  for (const m of OPTION_MARKETS) {
    const market = await prisma.optionMarket.upsert({
      where: { symbol: m.symbol },
      create: { symbol: m.symbol, enabled: true, currency: m.currency, minInvestment: m.minInvestment, maxInvestment: m.maxInvestment },
      update: { enabled: true, currency: m.currency, minInvestment: m.minInvestment, maxInvestment: m.maxInvestment },
    })
    for (const d of m.durations) {
      await prisma.optionDuration.upsert({
        where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: d.durationSeconds } },
        create: { optionMarketId: market.id, durationSeconds: d.durationSeconds, enabled: true, payoutPercent: d.payoutPercent },
        update: { payoutPercent: d.payoutPercent },
      })
    }
  }
  console.log(`Seeded options-trading settings + ${OPTION_MARKETS.length} example option markets (options.tradingEnabled remains OFF platform-wide until an admin turns it on).`)

  // Checkpoint K — crypto deposit ASSET metadata only (symbol/name), each
  // `enabled: false`. Deliberately seeds ZERO CryptoDepositAddress rows —
  // Part 33 is a HARD REQUIREMENT against any receiving address (real or
  // fake-but-plausible) living in source/seed data; an admin must
  // explicitly configure a real receiving address per network through the
  // step-up-gated admin UI before any asset can actually receive a
  // deposit. Automated tests that need an address create their own
  // disposable-database fixture directly (see
  // test/crypto-deposits.e2e-spec.ts) — never through this seed script.
  const CRYPTO_ASSETS: { symbol: string; name: string; sortOrder: number }[] = [
    { symbol: 'USDT', name: 'Tether', sortOrder: 0 },
    { symbol: 'BTC', name: 'Bitcoin', sortOrder: 1 },
    { symbol: 'ETH', name: 'Ethereum', sortOrder: 2 },
    { symbol: 'BNB', name: 'BNB', sortOrder: 3 },
    { symbol: 'SOL', name: 'Solana', sortOrder: 4 },
    { symbol: 'XRP', name: 'XRP', sortOrder: 5 },
    { symbol: 'ADA', name: 'Cardano', sortOrder: 6 },
    { symbol: 'DOGE', name: 'Dogecoin', sortOrder: 7 },
    { symbol: 'TRX', name: 'TRON', sortOrder: 8 },
    { symbol: 'LTC', name: 'Litecoin', sortOrder: 9 },
  ]
  for (const a of CRYPTO_ASSETS) {
    await prisma.cryptoAsset.upsert({
      where: { symbol: a.symbol },
      create: { symbol: a.symbol, name: a.name, sortOrder: a.sortOrder, enabled: false },
      update: { name: a.name, sortOrder: a.sortOrder },
    })
  }
  console.log(`Seeded ${CRYPTO_ASSETS.length} crypto asset definitions (all disabled, zero receiving addresses — an admin must configure a real address per network before any asset can receive a deposit).`)

  for (const [index, name] of DEFAULT_SUPPORT_CATEGORIES.entries()) {
    await prisma.supportCategory.upsert({
      where: { name },
      create: { name, order: index },
      update: { order: index },
    })
  }

  await seedCmsContent()

  console.log('Seed complete (permissions + platform settings + market configs + default support categories + CMS starter content — no user account was created).')
  console.log('Run `npm run admin:create-superadmin` next to create your first administrator.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
