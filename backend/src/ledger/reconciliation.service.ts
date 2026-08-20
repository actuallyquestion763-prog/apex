import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Reconciliation foundation (Phase 5, Part 8) — internal-only for now
 * ("does every customer balance equal the ledger" is answerable today;
 * "does the ledger equal external payment/trading records" is not, since
 * no external provider is connected yet — see Part 12/13).
 *
 * HARD RULE: every method here is read-only. There is no method on this
 * service, anywhere, that calls .create/.update/.delete/.upsert on
 * anything. A discrepancy is reported, never silently repaired — see each
 * check's comment for why silent repair would be actively dangerous (it
 * would hide the bug that caused the discrepancy, or worse, "fix" real
 * money based on a guess about what the correct value should have been).
 *
 * Several of these checks (orphaned rows) are currently impossible to
 * trigger through the application's own Prisma models, because the schema
 * enforces the relevant foreign keys. They're implemented as real queries
 * anyway — the value of reconciliation is precisely in checking things a
 * single code path already assumes are impossible, not in trusting that
 * assumption. Only a raw SQL statement bypassing Prisma, or a schema change
 * that removed a constraint, could ever make these checks find something.
 */

export type IssueSeverity = 'WARNING' | 'CRITICAL'

export interface ReconciliationIssue {
  check: string
  severity: IssueSeverity
  description: string
  details: Record<string, unknown>
}

export interface ReconciliationReport {
  generatedAt: string
  ok: boolean
  issueCount: number
  issues: ReconciliationIssue[]
  summary: {
    ledgerTransactionsChecked: number
    ledgerAccountsChecked: number
    depositsChecked: number
    withdrawalsChecked: number
  }
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<ReconciliationReport> {
    const issues: ReconciliationIssue[] = []

    const [txCount, unbalanced] = await Promise.all([
      this.prisma.ledgerTransaction.count(),
      this.findUnbalancedTransactions(),
    ])
    issues.push(...unbalanced)

    const [accountCount, orphanedEntries, orphanedAccounts, negativeBalances] = await Promise.all([
      this.prisma.ledgerAccount.count(),
      this.findOrphanedLedgerEntries(),
      this.findOrphanedLedgerAccounts(),
      this.findNegativeBalances(),
    ])
    issues.push(...orphanedEntries, ...orphanedAccounts, ...negativeBalances)

    const [depositCount, withdrawalCount, depositIssues, withdrawalIssues] = await Promise.all([
      this.prisma.deposit.count(),
      this.prisma.withdrawal.count(),
      this.findImpossibleDepositStates(),
      this.findImpossibleWithdrawalStates(),
    ])
    issues.push(...depositIssues, ...withdrawalIssues)

    return {
      generatedAt: new Date().toISOString(),
      ok: issues.length === 0,
      issueCount: issues.length,
      issues,
      summary: {
        ledgerTransactionsChecked: txCount,
        ledgerAccountsChecked: accountCount,
        depositsChecked: depositCount,
        withdrawalsChecked: withdrawalCount,
      },
    }
  }

  // Every LedgerTransaction's entries must sum to zero (credits == debits)
  // per currency — LedgerService.postTransaction() already enforces this at
  // write time (see validateEntries there), so finding one here would mean
  // that guarantee was somehow bypassed, not that it's expected to happen.
  private async findUnbalancedTransactions(): Promise<ReconciliationIssue[]> {
    const transactions = await this.prisma.ledgerTransaction.findMany({
      select: { id: true, description: true, entries: { select: { direction: true, amount: true, currency: true } } },
    })
    const issues: ReconciliationIssue[] = []
    for (const tx of transactions) {
      const byCurrency = new Map<string, { credits: Decimal; debits: Decimal }>()
      for (const e of tx.entries) {
        const bucket = byCurrency.get(e.currency) ?? { credits: new Decimal(0), debits: new Decimal(0) }
        if (e.direction === 'CREDIT') bucket.credits = bucket.credits.plus(e.amount)
        else bucket.debits = bucket.debits.plus(e.amount)
        byCurrency.set(e.currency, bucket)
      }
      for (const [currency, { credits, debits }] of byCurrency) {
        if (!credits.equals(debits)) {
          issues.push({
            check: 'unbalanced_transaction',
            severity: 'CRITICAL',
            description: `LedgerTransaction ${tx.id} is unbalanced in ${currency}.`,
            details: { transactionId: tx.id, currency, credits: credits.toString(), debits: debits.toString() },
          })
        }
      }
    }
    return issues
  }

  private async findOrphanedLedgerEntries(): Promise<ReconciliationIssue[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; ledgerAccountId: string }[]>`
      SELECT le.id, le."ledgerAccountId"
      FROM "LedgerEntry" le
      LEFT JOIN "LedgerAccount" la ON la.id = le."ledgerAccountId"
      WHERE la.id IS NULL
    `
    return rows.map((r) => ({
      check: 'orphaned_ledger_entry',
      severity: 'CRITICAL' as const,
      description: `LedgerEntry ${r.id} references a nonexistent LedgerAccount ${r.ledgerAccountId}.`,
      details: { entryId: r.id, ledgerAccountId: r.ledgerAccountId },
    }))
  }

  private async findOrphanedLedgerAccounts(): Promise<ReconciliationIssue[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; accountId: string }[]>`
      SELECT la.id, la."accountId"
      FROM "LedgerAccount" la
      WHERE la."ownerType" = 'USER' AND la."accountId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Account" a WHERE a.id = la."accountId")
    `
    return rows.map((r) => ({
      check: 'orphaned_ledger_account',
      severity: 'CRITICAL' as const,
      description: `LedgerAccount ${r.id} references a nonexistent Account ${r.accountId}.`,
      details: { ledgerAccountId: r.id, accountId: r.accountId },
    }))
  }

  // A USER-owned CASH or RESERVED account going negative means either a
  // concurrency bug slipped past the advisory-lock protection in
  // WithdrawalsService/OrdersService, or a manual/administrative ledger
  // entry was posted incorrectly. Either way: report, never auto-credit
  // funds to "fix" it — that would be creating money to paper over a
  // problem no one has diagnosed yet.
  private async findNegativeBalances(): Promise<ReconciliationIssue[]> {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: 'USER', type: { in: ['CASH', 'RESERVED'] } },
      select: { id: true, accountId: true, type: true, currency: true },
    })
    const issues: ReconciliationIssue[] = []
    for (const acc of accounts) {
      const [credits, debits] = await Promise.all([
        this.prisma.ledgerEntry.aggregate({ where: { ledgerAccountId: acc.id, direction: 'CREDIT' }, _sum: { amount: true } }),
        this.prisma.ledgerEntry.aggregate({ where: { ledgerAccountId: acc.id, direction: 'DEBIT' }, _sum: { amount: true } }),
      ])
      const balance = (credits._sum.amount ?? new Decimal(0)).minus(debits._sum.amount ?? new Decimal(0))
      if (balance.lt(0)) {
        issues.push({
          check: 'negative_balance',
          severity: 'CRITICAL',
          description: `${acc.type} account ${acc.id} (Account ${acc.accountId}) has a negative balance.`,
          details: { ledgerAccountId: acc.id, accountId: acc.accountId, type: acc.type, currency: acc.currency, balance: balance.toString() },
        })
      }
    }
    return issues
  }

  // A CONFIRMED deposit is money the platform claims a customer has —
  // there must be a real LedgerTransaction backing that claim (see
  // DepositsService.confirm(), which always sets both together inside one
  // operation). Finding a mismatch means the claim and the ledger have
  // diverged, which is exactly the kind of thing reconciliation exists to
  // surface before it becomes a customer-facing dispute.
  private async findImpossibleDepositStates(): Promise<ReconciliationIssue[]> {
    const rows = await this.prisma.deposit.findMany({
      where: { status: 'CONFIRMED', ledgerTransactionId: null },
      select: { id: true, userId: true, amount: true, currency: true },
    })
    return rows.map((d) => ({
      check: 'confirmed_deposit_missing_ledger_transaction',
      severity: 'CRITICAL' as const,
      description: `Deposit ${d.id} is CONFIRMED but has no linked LedgerTransaction.`,
      details: { depositId: d.id, userId: d.userId, amount: d.amount.toString(), currency: d.currency },
    }))
  }

  // A withdrawal past PENDING (i.e. its funds were already reserved — see
  // WithdrawalsService.createWithdrawal(), which reserves at request time,
  // not approval time) must have a LedgerTransaction recording that
  // reservation. REJECTED is excluded on purpose: reject() posts its own
  // (separate) refund transaction, but the ORIGINAL request's
  // ledgerTransactionId field is never cleared, so a rejected withdrawal
  // still legitimately has one from its original reservation.
  private async findImpossibleWithdrawalStates(): Promise<ReconciliationIssue[]> {
    const rows = await this.prisma.withdrawal.findMany({
      where: { status: { in: ['REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED'] }, ledgerTransactionId: null },
      select: { id: true, userId: true, amount: true, currency: true, status: true },
    })
    return rows.map((w) => ({
      check: 'withdrawal_missing_ledger_transaction',
      severity: 'CRITICAL' as const,
      description: `Withdrawal ${w.id} is ${w.status} but has no linked LedgerTransaction.`,
      details: { withdrawalId: w.id, userId: w.userId, amount: w.amount.toString(), currency: w.currency, status: w.status },
    }))
  }
}
