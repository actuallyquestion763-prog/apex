import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { LedgerAccountType, LedgerOwnerType, Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import type { AccountBalances, PostTransactionInput } from './ledger.types'

/**
 * LedgerService — the single authoritative source of financial truth.
 *
 * Hard rules enforced here, not just documented:
 *  1. No balance is ever stored directly. Every balance is derived by
 *     summing LedgerEntry rows for a LedgerAccount (CREDIT increases it,
 *     DEBIT decreases it — standard double-entry convention for an
 *     asset-type account, which is what a customer cash/reserved account is).
 *  2. Every postTransaction() call must balance: for each currency present,
 *     SUM(credits) === SUM(debits). A caller that gets this wrong gets a
 *     BadRequestException, not a silently-accepted unbalanced transaction.
 *  3. postTransaction() runs inside a single Prisma $transaction — the
 *     LedgerTransaction row and all its LedgerEntry rows are created
 *     together or not at all.
 *  4. Idempotency: if `idempotencyKey` is supplied and a LedgerTransaction
 *     with that key already exists, postTransaction() returns the EXISTING
 *     transaction instead of creating a duplicate. This is what makes a
 *     retried webhook, a duplicate button click, or a network retry safe.
 *
 * Convention used throughout the codebase:
 *   DEPOSIT:            debit SYSTEM_SUSPENSE,  credit USER_CASH
 *   WITHDRAWAL:         debit USER_CASH,        credit SYSTEM_SUSPENSE
 *   TRADE_RESERVATION:  debit USER_CASH,        credit USER_RESERVED
 *   TRADE_RELEASE:      debit USER_RESERVED,    credit USER_CASH
 *   REALIZED_PROFIT:    debit SYSTEM_REVENUE,   credit USER_CASH
 *   REALIZED_LOSS:      debit USER_CASH,        credit SYSTEM_REVENUE
 *   FEE:                debit USER_CASH,        credit SYSTEM_FEES
 *   ADJUSTMENT:         whichever direction the admin adjustment requires,
 *                       counterparty is SYSTEM_REVENUE (documented at the
 *                       call site in AdminService)
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger('LedgerService')

  constructor(private readonly prisma: PrismaService) {}

  // ---- System ledger accounts (singletons, created lazily) ----------------

  // System ledger accounts have accountId = NULL, and Postgres treats NULL
  // as distinct from NULL for uniqueness purposes — @@unique([accountId,
  // type, currency]) does NOT protect these rows the way it protects per-user ones
  // (see getOrCreateUserLedgerAccount below). Two concurrent first-time
  // callers could otherwise both pass the "not found" check and both
  // create a row. Fixed with a deterministic advisory lock per
  // (type, currency) instead of a schema change — no migration needed,
  // and no already-applied migration touched.
  async getSystemLedgerAccount(type: LedgerAccountType, currency = 'USD') {
    const existing = await this.prisma.ledgerAccount.findFirst({
      where: { ownerType: LedgerOwnerType.SYSTEM, type, currency },
    })
    if (existing) return existing

    const lockKey = `system-ledger-account:${type}:${currency}`
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

      // Re-check inside the lock: another caller may have created it while
      // this one was waiting to acquire the lock.
      const recheck = await tx.ledgerAccount.findFirst({
        where: { ownerType: LedgerOwnerType.SYSTEM, type, currency },
      })
      if (recheck) return recheck

      return tx.ledgerAccount.create({
        data: { ownerType: LedgerOwnerType.SYSTEM, type, currency, accountId: null },
      })
    })
  }

  // ---- Per-customer-Account ledger accounts --------------------------------

  async getOrCreateUserLedgerAccounts(accountId: string, currency = 'USD') {
    const [cash, reserved] = await Promise.all([
      this.getOrCreateUserLedgerAccount(accountId, LedgerAccountType.CASH, currency),
      this.getOrCreateUserLedgerAccount(accountId, LedgerAccountType.RESERVED, currency),
    ])
    return { cash, reserved }
  }

  private async getOrCreateUserLedgerAccount(accountId: string, type: LedgerAccountType, currency: string) {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { accountId_type_currency: { accountId, type, currency } },
    })
    if (existing) return existing
    try {
      return await this.prisma.ledgerAccount.create({
        data: { accountId, ownerType: LedgerOwnerType.USER, type, currency },
      })
    } catch (err) {
      // Two concurrent requests touching this account/currency's FIRST-EVER
      // financial event (e.g. two simultaneous admin adjustments, or an
      // order and a withdrawal, against a brand-new account) can both see
      // "no CASH/RESERVED ledger account yet for this currency" and both
      // try to create one. The @@unique([accountId, type, currency])
      // constraint is the real guard — catch the race here and return the
      // winner's row instead of a 500, same pattern already used for
      // idempotencyKey races in postTransaction(). Verified via a real
      // concurrent-request test against PostgreSQL
      // (test/concurrency-hardening.e2e-spec.ts).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.ledgerAccount.findUnique({
          where: { accountId_type_currency: { accountId, type, currency } },
        })
        if (winner) return winner
      }
      throw err
    }
  }

  // ---- Balance derivation ---------------------------------------------------

  async getLedgerAccountBalance(ledgerAccountId: string): Promise<Decimal> {
    return this.getLedgerAccountBalanceWith(this.prisma, ledgerAccountId)
  }

  // Same computation, but usable with a transaction client so a caller can
  // read the balance from INSIDE a locked transaction (see
  // postTransactionWithAccountLock) and see a consistent, lock-protected view.
  private async getLedgerAccountBalanceWith(
    client: Pick<Prisma.TransactionClient, 'ledgerEntry'> | PrismaService,
    ledgerAccountId: string,
  ): Promise<Decimal> {
    const [credits, debits] = await Promise.all([
      client.ledgerEntry.aggregate({
        where: { ledgerAccountId, direction: 'CREDIT' },
        _sum: { amount: true },
      }),
      client.ledgerEntry.aggregate({
        where: { ledgerAccountId, direction: 'DEBIT' },
        _sum: { amount: true },
      }),
    ])
    const creditSum = credits._sum.amount ?? new Decimal(0)
    const debitSum = debits._sum.amount ?? new Decimal(0)
    return creditSum.minus(debitSum)
  }

  async getAccountBalances(accountId: string, currency = 'USD'): Promise<AccountBalances> {
    const { cash, reserved } = await this.getOrCreateUserLedgerAccounts(accountId, currency)
    const [cashBalance, reservedBalance] = await Promise.all([
      this.getLedgerAccountBalance(cash.id),
      this.getLedgerAccountBalance(reserved.id),
    ])
    return { cash: cashBalance, reserved: reservedBalance, total: cashBalance.plus(reservedBalance) }
  }

  // ---- The core primitive ---------------------------------------------------

  private validateEntries(entries: PostTransactionInput['entries']) {
    if (entries.length < 2) {
      throw new BadRequestException('A ledger transaction requires at least two entries (double-entry).')
    }
    const byCurrency = new Map<string, { credits: Decimal; debits: Decimal }>()
    for (const entry of entries) {
      const currency = entry.currency ?? 'USD'
      const amount = new Decimal(entry.amount)
      if (amount.lte(0)) throw new BadRequestException('Ledger entry amounts must be positive; direction carries the sign.')
      const bucket = byCurrency.get(currency) ?? { credits: new Decimal(0), debits: new Decimal(0) }
      if (entry.direction === 'CREDIT') bucket.credits = bucket.credits.plus(amount)
      else bucket.debits = bucket.debits.plus(amount)
      byCurrency.set(currency, bucket)
    }
    for (const [currency, { credits, debits }] of byCurrency) {
      if (!credits.equals(debits)) {
        throw new BadRequestException(
          `Unbalanced ledger transaction for ${currency}: credits ${credits.toString()} != debits ${debits.toString()}.`,
        )
      }
    }
  }

  async postTransaction(input: PostTransactionInput) {
    this.validateEntries(input.entries)

    if (input.idempotencyKey) {
      const existing = await this.prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { entries: true },
      })
      if (existing) {
        this.logger.log(`Idempotent replay for key ${input.idempotencyKey} — returning existing transaction ${existing.id}, no new entries posted.`)
        return existing
      }
    }

    try {
      return await this.prisma.$transaction((tx) => this.insertTransaction(tx, input))
    } catch (err) {
      // Unique constraint race on idempotencyKey: two concurrent requests
      // with the same key both passed the pre-check above and both tried to
      // insert. One wins; the other lands here and should resolve to the
      // winner's transaction rather than error out.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
        const winner = await this.prisma.ledgerTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { entries: true },
        })
        if (winner) return winner
      }
      throw err
    }
  }

  /**
   * Same guarantees as postTransaction(), PLUS real concurrency safety for
   * "check a balance, then post an entry against it" sequences (deposits
   * don't need this — they only ever increase a balance; withdrawals and
   * trade reservations do, since two of them racing against the same
   * account is exactly how an account could be overdrawn).
   *
   * Acquires a PostgreSQL transaction-scoped advisory lock
   * (`pg_advisory_xact_lock`, keyed by hashing `lockKey`, released
   * automatically at commit/rollback) BEFORE running `precondition` and
   * BEFORE inserting the entries, all inside one database transaction. A
   * second concurrent call with the same `lockKey` blocks at the lock
   * acquisition until the first call's transaction commits or rolls back —
   * there is no window where both calls can see the same "balance before"
   * and both decide to proceed. This is a real lock, not the earlier
   * check-then-reverse-if-negative mitigation.
   *
   * `lockKey` should be the ledger account id being protected (e.g. a
   * user's CASH account) — every caller contending for the same funds must
   * use the same key.
   */
  async postTransactionWithAccountLock(
    lockKey: string,
    input: PostTransactionInput,
    precondition?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const { transaction } = await this.postTransactionWithAccountLockDetectingReplay(lockKey, input, precondition)
    return transaction
  }

  /**
   * Same guarantees as postTransactionWithAccountLock(), plus tells the
   * caller whether THIS call is the one that actually created the
   * transaction (`created: true`) or whether it resolved to an
   * already-existing one via the idempotency key (`created: false`).
   *
   * Phase 6F Checkpoint E, Part 2 — this is what closes the "concurrent
   * order sync writes duplicate audit rows" gap: under Checkpoint D's
   * plain postTransactionWithAccountLock(), every caller that reaches this
   * point (whether it won the race to insert or merely replayed an
   * existing transaction) looked identical from the outside, so a caller
   * had no way to know "should I ALSO write my Fill row and audit events,
   * or did someone else already do that." Exposing `created` lets
   * OrdersService gate its OWN side effects (Fill rows, audit events) on
   * "did I actually just create this financial transaction" — the same
   * serialization boundary (the advisory lock + idempotency key) that
   * already protects the ledger now also protects everything downstream of
   * it, for exactly the reason Part 2 asks for: move the dedup DECISION
   * and the audit EMISSION into the same boundary, using the existing
   * lock/idempotency architecture rather than a new mechanism.
   */
  async postTransactionWithAccountLockDetectingReplay(
    lockKey: string,
    input: PostTransactionInput,
    precondition?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<{ transaction: Awaited<ReturnType<LedgerService['insertTransaction']>>; created: boolean }> {
    this.validateEntries(input.entries)

    if (input.idempotencyKey) {
      const existing = await this.prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { entries: true },
      })
      if (existing) return { transaction: existing, created: false }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // hashtext() maps the key to a 32-bit int deterministically; two
        // calls with the same lockKey contend for the exact same lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

        // Re-check idempotency INSIDE the lock in case of a race between the
        // fast-path check above and lock acquisition. This is the exact
        // moment that decides `created` — whichever concurrent caller
        // acquires the lock FIRST inserts and gets created:true; every
        // other caller waiting on the same lockKey finds this row already
        // here once it's their turn and gets created:false.
        if (input.idempotencyKey) {
          const existing = await tx.ledgerTransaction.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: { entries: true },
          })
          if (existing) return { transaction: existing, created: false }
        }

        if (precondition) await precondition(tx)

        const created = await this.insertTransaction(tx, input)
        return { transaction: created, created: true }
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
        const winner = await this.prisma.ledgerTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { entries: true },
        })
        if (winner) return { transaction: winner, created: false }
      }
      throw err
    }
  }

  // Reads a balance from WITHIN a locked transaction — only meaningful
  // inside postTransactionWithAccountLock's precondition callback, where the
  // advisory lock guarantees no concurrent writer can be mid-flight.
  async getLedgerAccountBalanceLocked(tx: Prisma.TransactionClient, ledgerAccountId: string): Promise<Decimal> {
    return this.getLedgerAccountBalanceWith(tx, ledgerAccountId)
  }

  /**
   * Phase 6F Checkpoint E, Part 2 — for a caller that has ALREADY acquired
   * its own advisory lock and opened its own $transaction, and needs the
   * ledger entries to commit ATOMICALLY together with OTHER, non-ledger
   * writes on that same `tx` (e.g. OrdersService's incremental fill
   * settlement, which must commit its Fill rows and Order status update in
   * the exact same transaction as the ledger entries — not as separate
   * steps afterward, which is exactly the race that let two concurrent
   * syncs briefly disagree about an order's final status).
   *
   * Does NOT acquire a lock or open a transaction itself, and does NOT
   * re-check idempotency (the caller's own lock/idempotency-key check
   * already decided this is a genuinely new write) — it is the caller's
   * responsibility to have already established both. Still validates
   * entries and enforces currency-matching exactly like every other
   * posting path; a caller cannot use this to bypass those invariants.
   */
  async insertTransactionInLock(tx: Prisma.TransactionClient, input: PostTransactionInput) {
    this.validateEntries(input.entries)
    return this.insertTransaction(tx, input)
  }

  // A LedgerEntry's currency must always match the currency of the
  // LedgerAccount it posts against — the account's balance derivation
  // (SUM(credits) - SUM(debits)) has no per-currency grouping of its own,
  // so an entry posted with the wrong currency would silently corrupt that
  // account's balance in a currency it doesn't actually represent (e.g. a
  // BTC-denominated entry landing on a USD CASH account). Checked inside
  // the same transaction as the write, before anything is created, so a
  // mismatch rolls back the whole transaction — no partial write.
  private async assertEntryCurrenciesMatch(tx: Prisma.TransactionClient, entries: PostTransactionInput['entries']) {
    const accountIds = Array.from(new Set(entries.map((e) => e.ledgerAccountId)))
    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, currency: true },
    })
    const currencyByAccountId = new Map(accounts.map((a) => [a.id, a.currency]))
    for (const entry of entries) {
      const accountCurrency = currencyByAccountId.get(entry.ledgerAccountId)
      if (accountCurrency === undefined) {
        throw new BadRequestException(`Ledger entry references unknown ledger account ${entry.ledgerAccountId}.`)
      }
      const entryCurrency = entry.currency ?? 'USD'
      if (entryCurrency !== accountCurrency) {
        throw new BadRequestException(
          `Ledger entry currency ${entryCurrency} does not match ledger account ${entry.ledgerAccountId}'s currency ${accountCurrency}.`,
        )
      }
    }
  }

  private async insertTransaction(tx: Prisma.TransactionClient, input: PostTransactionInput) {
    await this.assertEntryCurrenciesMatch(tx, input.entries)

    return tx.ledgerTransaction.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        description: input.description,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        entries: {
          create: input.entries.map((e) => ({
            ledgerAccountId: e.ledgerAccountId,
            direction: e.direction,
            amount: new Decimal(e.amount),
            currency: e.currency ?? 'USD',
            entryType: e.entryType,
          })),
        },
      },
      include: { entries: true },
    })
  }
}
