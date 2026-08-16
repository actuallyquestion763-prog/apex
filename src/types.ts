export type ID = string

// ---- Backend-authoritative types --------------------------------------
// These mirror what the TRUST backend (backend/) actually returns. The
// frontend never invents or recomputes fields that belong here — it only
// displays what the server sent.

export type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN'
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED' | 'PENDING_VERIFICATION' | 'CLOSED'
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'

export interface User {
  id: ID
  email: string
  fullName: string
  country: string | null
  role: Role
  status: AccountStatus
  kycStatus: KycStatus
  twoFactorEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountSummary {
  accountId: string
  cash: string
  reserved: string
  total: string
  unrealizedPnl: string
  equity: string
  openPositionCount: number
}

export interface LedgerEntry {
  id: string
  ledgerAccount: 'CASH' | 'RESERVED' | string
  direction: 'DEBIT' | 'CREDIT'
  amount: string
  currency: string
  entryType: string
  description: string
  relatedType: string | null
  relatedId: string | null
  createdAt: string
}

export type OrderSide = 'BUY' | 'SELL'
export type OrderStatus = 'PENDING' | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED'

export interface Order {
  id: ID
  userId: ID
  accountId: ID
  symbol: string
  side: OrderSide
  quantity: string
  orderType: string
  requestedPrice: string | null
  executedPrice: string | null
  filledQuantity: string
  fee: string
  status: OrderStatus
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

export type PositionStatus = 'OPEN' | 'CLOSED'

export interface Position {
  id: ID
  userId: ID
  accountId: ID
  orderId: string | null
  symbol: string
  side: OrderSide
  quantity: string
  avgEntryPrice: string
  currentPrice: string | null
  realizedPnl: string
  fees: string
  status: PositionStatus
  openedAt: string
  closedAt: string | null
}

export type DepositStatus = 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'REVERSED'

export interface Deposit {
  id: ID
  userId: ID
  amount: string
  currency: string
  method: string
  providerReference: string | null
  status: DepositStatus
  createdAt: string
  confirmedAt: string | null
}

export type WithdrawalStatus = 'PENDING' | 'REVIEW' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED'

export interface Withdrawal {
  id: ID
  userId: ID
  amount: string
  currency: string
  destination: string
  status: WithdrawalStatus
  createdAt: string
  completedAt: string | null
}

export type MarketDataSource = 'LIVE' | 'SIMULATED'

export interface MarketConfig {
  id: string
  symbol: string
  dataSource: MarketDataSource
  tradingEnabled: boolean
  maintenanceMode: boolean
}

export interface PlatformSettings {
  tradingEnabled: boolean
  depositsEnabled: boolean
  withdrawalsEnabled: boolean
  registrationsEnabled: boolean
}

// ---- Local-only, non-financial state -----------------------------------
// Notifications have no backend model (foundation-phase gap). They are UI
// convenience only, never treated as authoritative for money/identity/etc.

export interface Notification {
  id: ID
  userId: ID
  title: string
  body: string
  read: boolean
  createdAt: number
  kind: 'price' | 'system' | 'deposit' | 'withdrawal' | 'kyc'
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TickerPrice {
  symbol: string
  name: string
  price: number
  change24h: number
  changePct: number
}
