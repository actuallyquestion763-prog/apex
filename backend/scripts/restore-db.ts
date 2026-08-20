// Restores a JSON logical backup (see backup-db.ts) into a target database.
// SAFETY: refuses to run against anything that looks like trust_dev, and
// refuses to run against a database where the target tables already have
// rows — this is a from-empty restore drill tool, never an "overwrite
// whatever is there" tool. See backup-restore-drill.ts for the actual
// Part 29 test this supports.
//
// Usage: DATABASE_URL=... npx ts-node scripts/restore-db.ts <input-file.json>
import 'dotenv/config'
import { readFileSync, existsSync } from 'fs'
import { createHash, createDecipheriv } from 'crypto'
import { PrismaClient } from '@prisma/client'

const ENCRYPTED_FORMAT = 'trust-backup-encrypted-v1'

function loadEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY
  if (!raw) return null
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).')
  }
  return Buffer.from(raw, 'hex')
}

// Checkpoint I.1, Part 6 — decrypts an AES-256-GCM backup produced by
// backup-db.ts. GCM's auth tag makes this fail loudly (not silently return
// garbage) on the wrong key or any tampering — this is verification, not
// just decryption.
function decryptBackup(rawContent: string, key: Buffer): string {
  const envelope = JSON.parse(rawContent) as { format: string; algorithm: string; iv: string; authTag: string; ciphertext: string }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}

function reviveDecimals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveDecimals)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('__decimal' in obj && typeof obj.__decimal === 'string') return obj.__decimal
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = reviveDecimals(v)
    return out
  }
  return value
}

async function main() {
  const inFile = process.argv[2]
  if (!inFile) {
    console.error('Usage: npx ts-node scripts/restore-db.ts <input-file.json>')
    process.exit(1)
  }

  const databaseUrl = process.env.DATABASE_URL ?? ''
  if (/trust_dev\b/i.test(databaseUrl)) {
    console.error('Refusing to restore into a database that looks like trust_dev. This tool is for disposable/staging restore drills only.')
    process.exit(1)
  }

  // Backup verification (Part 6/18): refuse to restore a file whose bytes
  // don't match the checksum recorded at backup time — catches silent
  // corruption/truncation from copying, storage, or transfer, which is
  // exactly the failure mode "a backup that was never verified" is meant
  // to guard against. Requires the file to have actually been produced by
  // backup-db.ts (or to have a correctly hand-placed .sha256 alongside it).
  const checksumFile = `${inFile}.sha256`
  const rawContent = readFileSync(inFile, 'utf8')
  if (!existsSync(checksumFile)) {
    console.error(`Refusing to restore: no checksum file found at ${checksumFile}. Every backup produced by backup-db.ts has one — restoring without it means the backup's integrity was never verified.`)
    process.exit(1)
  }
  const expectedChecksum = readFileSync(checksumFile, 'utf8').split(/\s+/)[0]
  const actualChecksum = createHash('sha256').update(rawContent).digest('hex')
  if (expectedChecksum !== actualChecksum) {
    console.error(`Refusing to restore: checksum mismatch. Expected ${expectedChecksum}, got ${actualChecksum}. The backup file may be corrupted or truncated.`)
    process.exit(1)
  }
  console.log(`Checksum verified: ${actualChecksum}`)

  // Detect an encrypted envelope BEFORE the general JSON.parse below — a
  // plaintext backup's top-level shape has no `format` field, so this never
  // misclassifies one.
  let plaintextContent = rawContent
  const probe = JSON.parse(rawContent) as { format?: string }
  if (probe.format === ENCRYPTED_FORMAT) {
    const key = loadEncryptionKey()
    if (!key) {
      console.error('Refusing to restore: this backup is encrypted (format=trust-backup-encrypted-v1) but BACKUP_ENCRYPTION_KEY is not set.')
      process.exit(1)
    }
    plaintextContent = decryptBackup(rawContent, key)
    console.log('Backup decrypted successfully (AES-256-GCM auth tag verified).')
  }

  const backup = JSON.parse(plaintextContent) as { tables: Record<string, Record<string, unknown>[]> }
  const prisma = new PrismaClient()

  try {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (rows.length === 0) continue
      const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM "${table}"`)
      if (Number(existing[0].count) > 0) {
        console.error(`Refusing to restore: target table "${table}" already has ${existing[0].count} row(s). This tool only restores into empty tables (post-migrate, pre-data).`)
        process.exit(1)
      }
    }

    let totalInserted = 0
    // Defers FK constraint checking until COMMIT so tables can be restored
    // in any order (the backup doesn't record a dependency order) — the
    // standard technique for bulk-loading a dump, same principle pg_restore
    // uses. Requires the connecting role to have REPLICATION or superuser
    // privilege, same as a real restore already requires.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET session_replication_role = replica')
      for (const [table, rawRows] of Object.entries(backup.tables)) {
        if (rawRows.length === 0) continue
        const rows = rawRows.map(reviveDecimals) as Record<string, unknown>[]
        const columns = Object.keys(rows[0])

        // A parameterized value sent via the extended query protocol does
        // NOT get PostgreSQL's literal-assignment-cast leniency (the thing
        // that lets a plain SQL string literal like '2024-01-01' land in a
        // timestamp column with no explicit cast) — every column needs an
        // explicit cast to its own type, enum/jsonb/timestamp/array alike.
        const colTypes = await tx.$queryRawUnsafe<{ column_name: string; data_type: string; udt_name: string }[]>(
          `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
          table,
        )
        const castFor = new Map(colTypes.map((c) => {
          if (c.udt_name.startsWith('_')) return [c.column_name, `::${c.udt_name.slice(1)}[]`] // array column, e.g. _text -> text[]
          if (c.data_type === 'USER-DEFINED') return [c.column_name, `::"${c.udt_name}"`] // enum
          return [c.column_name, `::${c.udt_name}`] // builtin (timestamp, numeric, text, bool, uuid, jsonb, int4, ...)
        }))

        const isArrayCol = new Map(colTypes.map((c) => [c.column_name, c.udt_name.startsWith('_')]))
        const colList = columns.map((c) => `"${c}"`).join(', ')
        const placeholders = columns.map((c, i) => `$${i + 1}${castFor.get(c) ?? ''}`).join(', ')
        for (const row of rows) {
          const values = columns.map((c) => {
            const v = row[c]
            if (Array.isArray(v) && isArrayCol.get(c)) {
              // Postgres array literal syntax ('{a,b}'), not JSON — a plain
              // string element list is all this schema currently uses
              // (Withdrawal.riskFlags), so simple double-quoting per
              // element is sufficient here.
              return `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}`
            }
            if (v && typeof v === 'object') return JSON.stringify(v)
            return v
          })
          await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`, ...values)
          totalInserted++
        }
      }
      await tx.$executeRawUnsafe('SET session_replication_role = DEFAULT')
    })

    console.log(`Restored ${totalInserted} rows across ${Object.keys(backup.tables).length} tables.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
