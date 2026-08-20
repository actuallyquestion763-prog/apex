import type { ExecutionStatus } from '../types'

// Spot Holdings Visibility checkpoint, Part 5 — environment-aware empty-state
// copy for holdings panels (AssetsPage, TradePage), mirroring the pattern
// already used for the Trade page's execution-status disclaimer. Never
// claims a live/production exchange is connected.
export function holdingsEmptyMessage(status: ExecutionStatus | null): string {
  switch (status?.provider) {
    case 'BinanceSandbox':
      return 'Your spot holdings will appear here after a filled trade.'
    case 'Disabled':
      return 'Trading execution is currently disabled.'
    default:
      return 'Simulation holdings will appear here after a simulated trade.'
  }
}
