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
// a real credential — see test/create-superadmin.e2e-spec.ts.
//
// Email + password only, deliberately no TOTP step here: this script's job
// is getting the FIRST admin into an otherwise-empty database, which is
// exactly the moment a broken/unreachable authenticator setup would leave
// an operator completely locked out with no existing admin able to help.
// Ordinary 2FA (setup/confirm/login-verify — see src/auth/auth.service.ts
// and src/auth/totp.util.ts) is completely unchanged and still fully
// enforced for every account, including this one: the account created here
// simply starts with twoFactorEnabled=false, same as any other new
// account, and can enable real TOTP afterward through the normal
// authenticated 2FA-setup flow like any user. Anything gated behind
// step-up re-authentication (src/common/security/step-up.service.ts)
// already refuses to proceed for an admin with 2FA disabled — that
// protection is untouched and will apply here too until 2FA is enabled.
import 'dotenv/config'
import type { PrismaClient } from '@prisma/client'
import { PrismaClient as RealPrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import * as readline from 'readline'
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
  io.log('hash in the database. This account is created with two-factor authentication')
  io.log('disabled — you can enable it afterward, once signed in, from your account')
  io.log('security settings.\n')

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
        // twoFactorEnabled defaults to false in the schema — set explicitly
        // here anyway so the intent is unambiguous at the call site: no
        // TOTP secret is generated or stored for this account (no
        // TwoFactorCredential row is created below either).
        role: 'SUPER_ADMIN', status: 'ACTIVE', kycStatus: 'VERIFIED', twoFactorEnabled: false,
        referralCode: generateReferralCode(),
      },
    })
    await tx.account.create({ data: { userId: user.id } })
    return user.id
  })

  io.log(`\nSuper Admin account created: ${email}`)
  io.log('Only the Argon2 password hash was stored — the plain password was never')
  io.log('written anywhere. You can sign in now with your email and password.')
  io.log('Two-factor authentication is not enabled on this account yet — you can turn')
  io.log('it on afterward from your account security settings once signed in. Until')
  io.log('then, actions that require step-up re-authentication (e.g. financial')
  io.log('adjustments, role changes) will ask you to enable 2FA first.')

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
