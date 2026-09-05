export type OptionsRiskReasonCode =
  | 'OPTIONS_TRADING_DISABLED'
  | 'ACCOUNT_TRADING_DISABLED'
  | 'USER_NOT_ALLOWED_TO_TRADE'
  | 'ASSET_DISABLED'
  | 'DURATION_DISABLED'
  | 'INVALID_INVESTMENT_AMOUNT'
  | 'MIN_INVESTMENT_NOT_MET'
  | 'MAX_INVESTMENT_EXCEEDED'
  | 'DURATION_MIN_AMOUNT_NOT_MET'
  | 'INSUFFICIENT_AVAILABLE_BALANCE'
  | 'MAX_ACTIVE_TRADES_EXCEEDED'
  | 'MAX_EXPOSURE_EXCEEDED'

export interface OptionsRiskCheckResult {
  allowed: boolean
  reasonCode: OptionsRiskReasonCode | null
  message: string | null
}
