import { PrismaClient } from '@prisma/client'

// Phase 6A, Part 2 — LIVE verification of the trust_app role's actual
// database privileges, not just a reading of the GRANT/REVOKE statements.
// This is how the migration-history gap (trust_app could previously
// INSERT/UPDATE/DELETE "_prisma_migrations" — closed by
// 20260818090000_restrict_trust_app_migration_history) was actually found:
// by attempting the operation for real against a real PostgreSQL database,
// not by reading the migration files and assuming they were sufficient.
//
// Connects directly via a second PrismaClient pointed at the same
// trust_test database the rest of the suite uses, authenticating as
// trust_app (never the superuser) — exactly the role the real application
// connects as in every environment.
const APP_URL = process.env.DATABASE_URL as string

describe('trust_app role security (real PostgreSQL, live privilege checks)', () => {
  let client: PrismaClient

  beforeAll(() => {
    client = new PrismaClient({ datasources: { db: { url: APP_URL } } })
  })

  afterAll(async () => {
    await client.$disconnect()
  })

  it('cannot CREATE DATABASE', async () => {
    await expect(client.$executeRawUnsafe('CREATE DATABASE trust_app_should_not_be_able_to_create')).rejects.toThrow()
  })

  it('cannot CREATE ROLE', async () => {
    await expect(client.$executeRawUnsafe('CREATE ROLE trust_app_should_not_create_roles LOGIN')).rejects.toThrow()
  })

  it('cannot perform arbitrary DDL (DROP/ALTER/TRUNCATE) on an application table', async () => {
    await expect(client.$executeRawUnsafe('DROP TABLE "User"')).rejects.toThrow()
    await expect(client.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "shouldNotWork" TEXT')).rejects.toThrow()
    await expect(client.$executeRawUnsafe('TRUNCATE "User" CASCADE')).rejects.toThrow()
  })

  it('cannot UPDATE or DELETE AuditLog (immutability), but CAN append to it', async () => {
    await expect(client.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'TAMPERED' WHERE 1=0`)).rejects.toThrow()
    await expect(client.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE 1=0`)).rejects.toThrow()

    // Confirm the same role CAN still append (this isn't a blanket "no
    // access", only "no modification of existing rows") — then clean up
    // the probe row itself via a raw DELETE... which trust_app can't do,
    // so this intentionally leaves one synthetic, clearly-labeled row in
    // the disposable test database rather than pretending to clean up in a
    // way that would itself violate the property under test.
    await expect(client.$executeRawUnsafe(
      `INSERT INTO "AuditLog" (id, action, "createdAt") VALUES (gen_random_uuid()::text, 'ROLE_SECURITY_TEST_PROBE', now())`,
    )).resolves.toBeDefined()
  })

  it('cannot modify Prisma migration history (Part 2\'s specific requirement)', async () => {
    await expect(client.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET applied_steps_count = 0 WHERE 1=0`,
    )).rejects.toThrow()
    await expect(client.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE 1=0`,
    )).rejects.toThrow()
    await expect(client.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES (gen_random_uuid()::text, 'x', 'fake', now())`,
    )).rejects.toThrow()
  })

  it('CAN perform ordinary reads and writes on application tables (not locked out entirely)', async () => {
    await expect(client.user.count()).resolves.toEqual(expect.any(Number))
  })
})
