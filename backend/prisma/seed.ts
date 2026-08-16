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
  'withdrawals.read': 'View withdrawals',
  'withdrawals.review': 'Approve or reject withdrawals',
  'trading.read': 'View trading activity',
  'trading.control': 'Pause/resume trading platform-wide',
  'markets.read': 'View per-market configuration',
  'markets.control': 'Change per-market configuration',
  'ledger.read': 'View ledger transactions and balances',
  'ledger.adjust': 'Create financial adjustments',
  'audit.read': 'View the audit log',
  'platform.read': 'View the platform overview',
  'platform.control': 'Change platform-wide kill switches',
  'admins.read': 'View administrator accounts and their permissions',
  'admins.manage': 'Grant or revoke administrator permissions',
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

  const markets: { symbol: string; dataSource: MarketDataSource; tradingEnabled: boolean }[] = [
    { symbol: 'XAU/USD', dataSource: MarketDataSource.LIVE, tradingEnabled: false }, // enable explicitly once GoldAPI is verified live
    { symbol: 'BTC/USDT', dataSource: MarketDataSource.SIMULATED, tradingEnabled: false },
    { symbol: 'ETH/USDT', dataSource: MarketDataSource.SIMULATED, tradingEnabled: false },
  ]
  for (const m of markets) {
    await prisma.marketConfig.upsert({
      where: { symbol: m.symbol },
      create: m,
      update: { dataSource: m.dataSource },
    })
  }

  console.log('Seed complete (permissions + platform settings + market configs only — no user account was created).')
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
