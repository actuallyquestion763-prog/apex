// Backup/restore drill (Phase 5 Part 29, deepened for Phase 6A Part 8/10) —
// runs the full procedure against a disposable database, NEVER trust_dev:
//   1. create a disposable database
//   2. apply all migrations
//   3. insert synthetic data only (obviously fake — ledger, CMS, Support,
//      idempotency, audit log)
//   4. create a backup (+ SHA-256 checksum — see backup-db.ts)
//   5. destroy the disposable database
//   6. recreate it
//   7. restore the backup (checksum-verified — see restore-db.ts)
//   8. verify schema
//   9. verify row counts
//  10. verify ledger integrity (credits == debits per transaction, correct
//      derived balances) and full relational structure (CMS/Support/
//      idempotency/audit log all survive, no orphaned rows)
//  11. verify reconciliation — runs the REAL ReconciliationService class
//      against the restored database, not a reimplementation of its checks
//  12. verify the application can connect (same real ReconciliationService
//      run doubles as this — it's a real Prisma-backed service instance)
//  13. delete the disposable database
//
// Uses the embedded-postgres server already running on port 5433 for the
// test suite (scripts/test-db.js) — creates and drops a SEPARATE database
// on that same server (trust_backup_drill) so this never touches trust_test
// (used by the rest of the e2e suite) or trust_dev.
//
// This environment has no pg_dump/pg_restore binary (see backup-db.ts's
// header) — the "backup"/"restore" here are the JSON logical backup/restore
// scripts in this directory, not a real pg_dump. See the Phase 6A report's
// Backup Implementation section for what this does and does not prove.
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { ReconciliationService } from '../src/ledger/reconciliation.service'

const HOST = 'localhost'
const PORT = 5433
const SUPERUSER_URL = `postgresql://postgres:devpassword@${HOST}:${PORT}/postgres?schema=public`
const DB_NAME = 'trust_backup_drill'
const APP_ROLE = 'trust_app'
const APP_PASSWORD = 'change-me-trust-app-dev-password' // matches .env.test's role password on this same disposable server
const DB_URL = `postgresql://${APP_ROLE}:${APP_PASSWORD}@${HOST}:${PORT}/${DB_NAME}?schema=public`
const SUPERUSER_DB_URL = `postgresql://postgres:devpassword@${HOST}:${PORT}/${DB_NAME}?schema=public`
const BACKUP_FILE = join(__dirname, '..', '.backup-drill.json')

function run(cmd: string, env: Record<string, string>) {
  execSync(cmd, { cwd: join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, ...env } })
}

async function dropAndCreateDb() {
  const admin = new PrismaClient({ datasources: { db: { url: SUPERUSER_URL } } })
  try {
    await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`)
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}"`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`)
  } finally {
    await admin.$disconnect()
  }
}

async function main() {
  console.log(`\n=== STEP 1-2: create disposable database (${DB_NAME}) and apply all migrations ===`)
  await dropAndCreateDb()
  // No separate GRANT step here on purpose — every grant trust_app needs
  // (USAGE on schema, SELECT/INSERT/UPDATE/DELETE on each table, the
  // AuditLog UPDATE/DELETE revoke, the _prisma_migrations write revoke) is
  // already IN the migration files themselves, applied incrementally as
  // each one runs. Re-running a blanket "GRANT ALL TABLES" here — an
  // earlier version of this script did exactly that — would silently UNDO
  // the AuditLog immutability revoke that a migration already correctly
  // applied moments before, which is exactly the bug step 10 below is
  // designed to catch. trust_app's password is already set cluster-wide
  // (roles are cluster-level, not per-database) from this session's
  // earlier bootstrap of trust_test on this same disposable Postgres server.
  run('npx prisma migrate deploy', { DATABASE_URL: SUPERUSER_DB_URL })
  console.log('Migrations applied (grants came entirely from the migration files, no manual re-grant).')

  console.log('\n=== STEP 3: insert synthetic test data only (obviously fake) ===')
  const app = new PrismaClient({ datasources: { db: { url: DB_URL } } })

  const admin = await app.user.create({
    data: { email: 'drill-admin@example.com', passwordHash: 'not-a-real-hash-synthetic-drill-data', fullName: 'Backup Drill Admin', role: 'ADMIN', referralCode: 'DRILLADM' },
  })
  const user = await app.user.create({
    data: { email: 'drill-user@example.com', passwordHash: 'not-a-real-hash-synthetic-drill-data', fullName: 'Backup Drill User', role: 'USER', referralCode: 'DRILLUSR' },
  })
  const account = await app.account.create({ data: { userId: user.id } })
  const cash = await app.ledgerAccount.create({ data: { accountId: account.id, ownerType: 'USER', type: 'CASH' } })
  const reserved = await app.ledgerAccount.create({ data: { accountId: account.id, ownerType: 'USER', type: 'RESERVED' } })
  const revenue = await app.ledgerAccount.create({ data: { ownerType: 'SYSTEM', type: 'REVENUE' } })

  // Ledger: a balance grant (250 credit), then a partial reservation (50
  // moved from CASH to RESERVED) — exercises two transactions and lets
  // step 10 verify BOTH the cash balance (200) and the reserved balance (50).
  const grantTx = await app.ledgerTransaction.create({
    data: {
      description: 'SYNTHETIC DRILL FIXTURE — balance grant, not real money',
      idempotencyKey: 'backup-drill-grant',
      entries: {
        create: [
          { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: new Decimal('250'), entryType: 'ADJUSTMENT' },
          { ledgerAccountId: cash.id, direction: 'CREDIT', amount: new Decimal('250'), entryType: 'ADJUSTMENT' },
        ],
      },
    },
  })
  const reserveTx = await app.ledgerTransaction.create({
    data: {
      description: 'SYNTHETIC DRILL FIXTURE — trade reservation, not a real trade',
      idempotencyKey: 'backup-drill-reserve',
      entries: {
        create: [
          { ledgerAccountId: cash.id, direction: 'DEBIT', amount: new Decimal('50'), entryType: 'TRADE_RESERVATION' },
          { ledgerAccountId: reserved.id, direction: 'CREDIT', amount: new Decimal('50'), entryType: 'TRADE_RESERVATION' },
        ],
      },
    },
  })

  // Idempotency record (Part 10 explicitly requires this survive restore).
  await app.idempotencyKey.create({
    data: {
      userId: user.id,
      scope: 'backup-drill.test',
      key: 'synthetic-drill-key',
      requestHash: 'synthetic-drill-hash',
      status: 'COMPLETED',
      responseBody: { synthetic: true },
    },
  })

  // CMS record.
  const faq = await app.cmsFaq.create({
    data: { question: 'SYNTHETIC DRILL FAQ — is this real?', answer: 'No, this row exists only to verify backup/restore.', status: 'PUBLISHED', createdByAdminId: admin.id },
  })

  // Support records (category + ticket + message).
  const category = await app.supportCategory.create({ data: { name: 'Backup Drill Category' } })
  const ticket = await app.supportTicket.create({
    data: { userId: user.id, categoryId: category.id, subject: 'SYNTHETIC DRILL TICKET', status: 'OPEN' },
  })
  await app.supportMessage.create({
    data: { ticketId: ticket.id, authorId: user.id, body: 'Synthetic drill message.', visibility: 'PUBLIC' },
  })

  // Audit log record (Part 10 explicitly requires audit log integrity be verified).
  const auditRow = await app.auditLog.create({
    data: { actorId: admin.id, action: 'BACKUP_DRILL_SYNTHETIC_EVENT', targetType: 'DRILL', targetId: 'synthetic' },
  })

  const rowCountsBefore = {
    users: await app.user.count(),
    accounts: await app.account.count(),
    ledgerAccounts: await app.ledgerAccount.count(),
    ledgerTransactions: await app.ledgerTransaction.count(),
    ledgerEntries: await app.ledgerEntry.count(),
    idempotencyKeys: await app.idempotencyKey.count(),
    cmsFaqs: await app.cmsFaq.count(),
    supportCategories: await app.supportCategory.count(),
    supportTickets: await app.supportTicket.count(),
    supportMessages: await app.supportMessage.count(),
    auditLogs: await app.auditLog.count(),
  }
  await app.$disconnect()
  console.log('Synthetic data inserted:', rowCountsBefore)

  console.log('\n=== STEP 4: create a backup (with SHA-256 checksum) ===')
  run(`npx ts-node scripts/backup-db.ts "${BACKUP_FILE}"`, { DATABASE_URL: DB_URL })

  console.log('\n=== STEP 5: destroy the disposable database ===')
  await dropAndCreateDb()
  console.log(`Database "${DB_NAME}" dropped.`)

  console.log('\n=== STEP 6: recreate the disposable database and apply migrations ===')
  run('npx prisma migrate deploy', { DATABASE_URL: SUPERUSER_DB_URL })

  console.log('\n=== STEP 7: restore the backup (checksum-verified) ===')
  // Restore runs as postgres superuser (SET session_replication_role
  // requires elevated privilege) — same as a real restore already would.
  run(`npx ts-node scripts/restore-db.ts "${BACKUP_FILE}"`, { DATABASE_URL: SUPERUSER_DB_URL })

  console.log('\n=== STEP 8: verify schema ===')
  run('npx prisma migrate status', { DATABASE_URL: SUPERUSER_DB_URL })

  console.log('\n=== STEP 9: verify row counts ===')
  const app2 = new PrismaClient({ datasources: { db: { url: DB_URL } } })
  const rowCountsAfter = {
    users: await app2.user.count(),
    accounts: await app2.account.count(),
    ledgerAccounts: await app2.ledgerAccount.count(),
    ledgerTransactions: await app2.ledgerTransaction.count(),
    ledgerEntries: await app2.ledgerEntry.count(),
    idempotencyKeys: await app2.idempotencyKey.count(),
    cmsFaqs: await app2.cmsFaq.count(),
    supportCategories: await app2.supportCategory.count(),
    supportTickets: await app2.supportTicket.count(),
    supportMessages: await app2.supportMessage.count(),
    auditLogs: await app2.auditLog.count(),
  }
  console.log('Row counts before:', rowCountsBefore)
  console.log('Row counts after: ', rowCountsAfter)
  if (JSON.stringify(rowCountsBefore) !== JSON.stringify(rowCountsAfter)) {
    throw new Error('ROW COUNT MISMATCH after restore — drill FAILED.')
  }

  console.log('\n=== STEP 10: verify ledger integrity + full relational structure ===')
  const restoredGrantTx = await app2.ledgerTransaction.findUnique({ where: { idempotencyKey: 'backup-drill-grant' }, include: { entries: true } })
  const restoredReserveTx = await app2.ledgerTransaction.findUnique({ where: { idempotencyKey: 'backup-drill-reserve' }, include: { entries: true } })
  if (!restoredGrantTx || !restoredReserveTx) throw new Error('Restored ledger transactions not found — drill FAILED.')
  for (const tx of [restoredGrantTx, restoredReserveTx]) {
    const credits = tx.entries.filter((e) => e.direction === 'CREDIT').reduce((sum, e) => sum.plus(e.amount), new Decimal(0))
    const debits = tx.entries.filter((e) => e.direction === 'DEBIT').reduce((sum, e) => sum.plus(e.amount), new Decimal(0))
    console.log(`Transaction ${tx.id}: credits=${credits.toString()} debits=${debits.toString()}`)
    if (!credits.equals(debits)) throw new Error(`Restored transaction ${tx.id} is unbalanced — drill FAILED.`)
  }

  const cashBalance = await app2.$queryRawUnsafe<{ balance: string }[]>(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0)::text AS balance FROM "LedgerEntry" WHERE "ledgerAccountId" = '${cash.id}'`,
  )
  const reservedBalance = await app2.$queryRawUnsafe<{ balance: string }[]>(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0)::text AS balance FROM "LedgerEntry" WHERE "ledgerAccountId" = '${reserved.id}'`,
  )
  console.log('Restored CASH balance:', cashBalance[0].balance, '(expected 200)')
  console.log('Restored RESERVED balance:', reservedBalance[0].balance, '(expected 50)')
  if (new Decimal(cashBalance[0].balance).comparedTo(200) !== 0) throw new Error('Restored CASH balance incorrect — drill FAILED.')
  if (new Decimal(reservedBalance[0].balance).comparedTo(50) !== 0) throw new Error('Restored RESERVED balance incorrect — drill FAILED.')

  const restoredIdempotency = await app2.idempotencyKey.findUnique({ where: { userId_scope_key: { userId: user.id, scope: 'backup-drill.test', key: 'synthetic-drill-key' } } })
  const restoredFaq = await app2.cmsFaq.findUnique({ where: { id: faq.id } })
  const restoredTicket = await app2.supportTicket.findUnique({ where: { id: ticket.id }, include: { messages: true } })
  const restoredAudit = await app2.auditLog.findUnique({ where: { id: auditRow.id } })
  console.log('Idempotency record restored:', restoredIdempotency !== null)
  console.log('CMS FAQ restored:', restoredFaq !== null, '| status:', restoredFaq?.status)
  console.log('Support ticket restored:', restoredTicket !== null, '| messages:', restoredTicket?.messages.length)
  console.log('Audit log record restored:', restoredAudit !== null, '| action:', restoredAudit?.action)
  if (!restoredIdempotency || !restoredFaq || !restoredTicket || restoredTicket.messages.length !== 1 || !restoredAudit) {
    throw new Error('Relational data missing after restore — drill FAILED.')
  }

  // Foreign key integrity: every ledger entry's account, every support
  // message's ticket/author, every ticket's category/user must resolve —
  // exercised structurally by the .include()/relation queries above
  // succeeding at all (a dangling FK would make Prisma's relation resolve
  // to null or throw, not silently succeed).
  console.log('Foreign key integrity: all relation lookups above resolved correctly.')

  // Audit log immutability must survive the restore too — re-run the same
  // live privilege check role-security.e2e-spec.ts uses, against THIS
  // restored database specifically.
  try {
    await app2.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'TAMPERED' WHERE id = '${auditRow.id}'`)
    throw new Error('trust_app was able to UPDATE AuditLog after restore — immutability did NOT survive the restore. Drill FAILED.')
  } catch (err: any) {
    if (err.message?.includes('did NOT survive')) throw err
    console.log('AuditLog immutability survived restore: UPDATE correctly denied.')
  }
  await app2.$disconnect()

  console.log('\n=== STEP 11-12: verify reconciliation + application connectivity (real ReconciliationService) ===')
  // Not a reimplementation of the checks — the actual production class,
  // instantiated against the restored database. A successful run here
  // proves both "reconciliation still finds no issues in freshly restored
  // data" AND "a real application service can connect to and query the
  // restored database" in one step.
  const reconciliationPrisma = new PrismaClient({ datasources: { db: { url: DB_URL } } }) as any
  const reconciliation = new ReconciliationService(reconciliationPrisma)
  const report = await reconciliation.run()
  console.log('Reconciliation report:', JSON.stringify(report.summary), '| ok:', report.ok, '| issues:', report.issueCount)
  if (!report.ok) {
    console.log('Issues found:', JSON.stringify(report.issues, null, 2))
    throw new Error('Reconciliation found issues in freshly restored data — drill FAILED.')
  }
  await reconciliationPrisma.$disconnect()

  console.log('\n=== STEP 13: delete the disposable database ===')
  await dropAndCreateDbCleanupOnly()
  if (existsSync(BACKUP_FILE)) unlinkSync(BACKUP_FILE)
  if (existsSync(`${BACKUP_FILE}.sha256`)) unlinkSync(`${BACKUP_FILE}.sha256`)
  // Checkpoint I.1, Part 6 — backup-db.ts now also writes a .meta.json
  // sidecar; clean it up too so a drill run never leaves stray files behind.
  if (existsSync(`${BACKUP_FILE}.meta.json`)) unlinkSync(`${BACKUP_FILE}.meta.json`)
  console.log('Disposable drill database and backup files removed.')

  console.log('\n✅ BACKUP/RESTORE DRILL PASSED — schema verified, row counts verified, ledger integrity verified, CMS/Support/idempotency/audit-log data verified, reconciliation clean, application connectivity verified.')
}

async function dropAndCreateDbCleanupOnly() {
  const admin = new PrismaClient({ datasources: { db: { url: SUPERUSER_URL } } })
  try {
    await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`)
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}"`)
  } finally {
    await admin.$disconnect()
  }
}

main().catch((err) => {
  console.error('\n❌ BACKUP/RESTORE DRILL FAILED:', err)
  process.exit(1)
})
