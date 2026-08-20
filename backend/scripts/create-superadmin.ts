// Interactive, one-time SUPER_ADMIN bootstrap. Run with: npm run admin:create-superadmin
//
// This is the ONLY supported way to create the first SUPER_ADMIN in a given
// database. It intentionally does NOT read a password from an environment
// variable, a CLI flag, a config file, or any other non-interactive source —
// that would leave a credential sitting in a file, shell history, or process
// list. The password is typed at this prompt (not echoed to the terminal),
// used in-memory only to compute an Argon2 hash, and then discarded. Only
// the hash is ever written to the database.
//
// Refuses to run if a SUPER_ADMIN already exists (see the check below) —
// creating additional admins after the first one is done through the admin
// panel (role promotion by an existing SUPER_ADMIN, itself step-up-gated),
// not through this script.
//
// The bootstrap logic (`runBootstrap`) is decoupled from the terminal I/O
// (`ask`/`askHidden`) so it can be exercised in an automated test with a
// fake, in-memory `io` implementation, without ever touching a real TTY or
// a real credential — see test/create-superadmin.spec.ts.
import 'dotenv/config'
import type { PrismaClient } from '@prisma/client'
import { PrismaClient as RealPrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import * as readline from 'readline'
import { generateTotpSecret, buildOtpAuthUrl, verifyTotpCode } from '../src/auth/totp.util'
import { generateReferralCode } from '../src/auth/referral-code.util'

export interface BootstrapIO {
  ask(question: string): Promise<string>
  askHidden(question: string): Promise<string>
  log(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface BootstrapResult {
  ok: boolean
  reason?: string
  userId?: string
}

// The actual account-creation logic, independent of how questions get
// asked. Never logs a password. Never accepts one from anywhere but
// `io.askHidden`.
export async function runBootstrap(prisma: PrismaClient, io: BootstrapIO): Promise<BootstrapResult> {
  io.log('TRUST — Super Admin bootstrap')
  io.log('Creates the first SUPER_ADMIN account for this database. Your password is')
  io.log('typed here, never echoed, and is never written anywhere except as an Argon2')
  io.log('hash in the database. Two-factor authentication is required and configured')
  io.log('as part of this flow — the account will not be created without it.\n')

  const existingSuperAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })
  if (existingSuperAdmins > 0) {
    io.error('Refusing to continue: a SUPER_ADMIN account already exists in this database.')
    io.error('To add another administrator, sign in as an existing SUPER_ADMIN and use')
    io.error('the admin panel (Users -> Promote), which is step-up re-authentication')
    io.error('gated. This script only ever creates the FIRST Super Admin.')
    return { ok: false, reason: 'already_exists' }
  }

  const emailRaw = await io.ask('Email: ')
  const email = emailRaw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    io.error('That does not look like a valid email address.')
    return { ok: false, reason: 'invalid_email' }
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    io.error(`A user with email ${email} already exists. Choose a different email, or`)
    io.error('promote that existing account to SUPER_ADMIN from the admin panel instead.')
    return { ok: false, reason: 'email_taken' }
  }

  const fullNameRaw = await io.ask('Full name [Platform Owner]: ')
  const fullName = fullNameRaw.trim() || 'Platform Owner'

  const password = await io.askHidden('Password (min 12 characters, not shown): ')
  if (password.length < 12) {
    io.error('Password must be at least 12 characters.')
    return { ok: false, reason: 'password_too_short' }
  }
  const confirmPassword = await io.askHidden('Confirm password: ')
  if (password !== confirmPassword) {
    io.error('Passwords do not match. Nothing was created.')
    return { ok: false, reason: 'password_mismatch' }
  }

  const secret = generateTotpSecret()
  const otpAuthUrl = buildOtpAuthUrl(secret, email)
  io.log('\nTwo-factor authentication is required for this account.')
  io.log('Add it to your authenticator app now, either by pasting this URL somewhere')
  io.log('that can render it as a QR code, or by entering the key manually:')
  io.log(`\n  Key:  ${secret}`)
  io.log(`  URL:  ${otpAuthUrl}\n`)

  let verified = false
  for (let attempt = 1; attempt <= 5 && !verified; attempt++) {
    const code = (await io.ask(`Enter the 6-digit code from your authenticator app (attempt ${attempt}/5): `)).trim()
    verified = verifyTotpCode(secret, code)
    if (!verified) io.log('That code did not verify. Check the time on your device and try again.')
  }
  if (!verified) {
    io.error('\nCould not verify two-factor authentication after 5 attempts. Aborting —')
    io.error('no account was created. Run this script again when ready.')
    return { ok: false, reason: 'totp_not_verified' }
  }

  // Re-check immediately before writing to shrink the window between the
  // first check and now (a human was answering prompts in between). This is
  // best-effort, not a hard database constraint — an existing SUPER_ADMIN
  // legitimately promotes others later, so "at most one SUPER_ADMIN ever"
  // cannot be a permanent DB-level invariant.
  const stillNone = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })
  if (stillNone > 0) {
    io.error('A SUPER_ADMIN was created by someone else while this was running. Aborting —')
    io.error('no account was created.')
    return { ok: false, reason: 'race_lost' }
  }

  const passwordHash = await argon2.hash(password)

  const userId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email, passwordHash, fullName,
        role: 'SUPER_ADMIN', status: 'ACTIVE', kycStatus: 'VERIFIED', twoFactorEnabled: true,
        referralCode: generateReferralCode(),
      },
    })
    await tx.account.create({ data: { userId: user.id } })
    await tx.twoFactorCredential.create({ data: { userId: user.id, secret, enabled: true } })
    return user.id
  })

  io.log(`\nSuper Admin account created: ${email}`)
  io.log('Only the Argon2 password hash and the TOTP secret were stored — the plain')
  io.log('password was never written anywhere. You can sign in now with your email,')
  io.log('password, and an authenticator code.')

  return { ok: true, userId }
}

// ---- Real terminal I/O (only used when this file is run directly) --------

function buildRealIO(): BootstrapIO & { close(): void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) })

  function ask(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)))
  }

  // Masked password entry on the SAME shared readline interface: readline
  // exposes a mutable (undocumented but long-stable, widely used-in-the-wild)
  // `_writeToOutput` hook controlling exactly what gets echoed back for the
  // current prompt — swapping it out for the duration of one question masks
  // the input without hand-rolling raw-mode key handling or opening a
  // second interface (which loses buffered input on some platforms).
  function askHidden(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!process.stdin.isTTY) {
        reject(new Error('This script must be run in an interactive terminal (stdin is not a TTY) — password input cannot be piped or redirected.'))
        return
      }
      const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void }
      const original = rlAny._writeToOutput
      rlAny._writeToOutput = (stringToWrite: string) => {
        if (stringToWrite === question || stringToWrite.startsWith(question)) {
          process.stdout.write(question)
        }
      }
      rl.question(question, (answer) => {
        rlAny._writeToOutput = original
        process.stdout.write('\n')
        resolve(answer)
      })
    })
  }

  return { ask, askHidden, log: console.log, error: console.error, close: () => rl.close() }
}

async function runAsScript() {
  const prisma = new RealPrismaClient()
  const io = buildRealIO()
  try {
    const result = await runBootstrap(prisma, io)
    process.exitCode = result.ok ? 0 : 1
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    io.close()
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  runAsScript()
}
