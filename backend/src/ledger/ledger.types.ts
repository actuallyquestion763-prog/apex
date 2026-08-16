import { LedgerDirection, LedgerEntryType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

export interface LedgerEntryInput {
  ledgerAccountId: string
  direction: LedgerDirection
  amount: Decimal | string | number
  currency?: string
  entryType: LedgerEntryType
}

export interface PostTransactionInput {
  description: string
  entries: LedgerEntryInput[]
  idempotencyKey?: string
  relatedType?: string
  relatedId?: string
}

export interface AccountBalances {
  cash: Decimal
  reserved: Decimal
  total: Decimal // cash + reserved — total customer equity at rest (excludes unrealized P&L, which is derived from open positions, not the ledger)
}
