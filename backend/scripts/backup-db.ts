// Logical (JSON) backup of every table in the target database (Phase 5,
// Part 5). This environment has no pg_dump/pg_restore binary available
// (the embedded-postgres package bundles only postgres/pg_ctl/initdb — see
// backup-restore-drill.ts's header comment) — for a REAL production
// deployment, use actual pg_dump (custom format, -Fc) or your managed
// Postgres provider's native backup/snapshot feature; those are the real
// answer for Part 5/6, not this script. This script exists so the backup/
// restore ROUND TRIP (Part 29) can be genuinely executed and verified in
// this environment, and as a documented last-resort/dev-environment backup
// path — never the production one.
//
// Usage: DATABASE_URL=... npx ts-node scripts/backup-db.ts <output-file.json>
//
// Writes a companion <output-file.json>.sha256 checksum file alongside the
// backup (Phase 6A, Part 7/18 — "a backup that has never been verified is
// not considered verified"; this is the first, cheapest layer of that: did
// the file arrive/get copied/get stored intact, before ever asking "is the
// DATA inside it correct" — restore-db.ts refuses to run without a matching
// checksum).
import 'dotenv/config'
import { writeFileSync } from 'fs'
import { createHash, createCipheriv, randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'

// Checkpoint I.1, Part 6 — optional AES-256-GCM encryption at rest, gated
// by BACKUP_ENCRYPTION_KEY (64 hex chars = 32 bytes). Deliberately opt-in
// rather than mandatory: this script is documented above as a dev-environment/
// last-resort path, not the real production answer (a managed Postgres
// provider's native encrypted snapshot is) — but when a key IS provided,
// the artifact written to disk is genuinely never plaintext.
const ENCRYPTED_FORMAT = 'trust-backup-encrypted-v1'
const BACKUP_FORMAT_VERSION = 'trust-backup-v1'

function loadEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY
  if (!raw) return null
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) — generate one with: openssl rand -hex 32')
  }
  return Buffer.from(raw, 'hex')
}

async function main() {
  const outFile = process.argv[2]
  if (!outFile) {
    console.error('Usage: npx ts-node scripts/backup-db.ts <output-file.json>')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations' ORDER BY tablename`,
    )

    const dump: Record<string, unknown[]> = {}
    let totalRows = 0
    for (const { tablename } of tables) {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${tablename}"`)
      dump[tablename] = rows
      totalRows += rows.length
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      tableCount: tables.length,
      totalRows,
      tables: dump,
    }

    // Decimal/Date/Buffer values from $queryRawUnsafe need a JSON-safe
    // serialization — toString() for anything with one preserves exact
    // Decimal precision (never converts through a floating-point number).
    const serialized = JSON.stringify(payload, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.toString === 'function' && value.constructor?.name === 'Decimal') {
        return { __decimal: value.toString() }
      }
      return value
    }, 2)
    const encryptionKey = loadEncryptionKey()
    let fileContents: string
    let encrypted = false
    if (encryptionKey) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
      const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      fileContents = JSON.stringify({ format: ENCRYPTED_FORMAT, algorithm: 'aes-256-gcm', iv: iv.toString('hex'), authTag: authTag.toString('hex'), ciphertext: ciphertext.toString('base64') })
      encrypted = true
    } else {
      fileContents = serialized
      console.warn('WARNING: BACKUP_ENCRYPTION_KEY is not set — this backup is being written UNENCRYPTED. Set BACKUP_ENCRYPTION_KEY (openssl rand -hex 32) before using this for anything beyond local disposable-DB testing.')
    }
    writeFileSync(outFile, fileContents)

    // Checksum is computed over exactly the bytes written to disk (the
    // encrypted artifact when encryption is on) — unchanged in spirit from
    // the pre-existing mechanism: "did the file arrive/get copied/get
    // stored intact." restore-db.ts still refuses to run without a match.
    const checksum = createHash('sha256').update(fileContents).digest('hex')
    writeFileSync(`${outFile}.sha256`, `${checksum}  ${outFile.split(/[\\/]/).pop()}\n`)

    // Metadata sidecar (Part 6) — lets an operator see backup provenance
    // (when, how many rows, whether it's encrypted) WITHOUT decrypting or
    // parsing the backup itself.
    const meta = {
      format: BACKUP_FORMAT_VERSION,
      generatedAt: payload.generatedAt,
      tableCount: payload.tableCount,
      totalRows: payload.totalRows,
      encrypted,
      checksumFile: `${outFile.split(/[\\/]/).pop()}.sha256`,
    }
    writeFileSync(`${outFile}.meta.json`, JSON.stringify(meta, null, 2))

    console.log(`Backed up ${tables.length} tables, ${totalRows} total rows, to ${outFile}${encrypted ? ' (encrypted)' : ''}`)
    console.log(`SHA-256: ${checksum}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
