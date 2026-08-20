import type {
  ExecutionProvider,
  ExecutionProviderHealth,
  ProviderBalance,
  ProviderFill,
  ProviderMarketStatus,
  ProviderOrderQuery,
  ProviderOrderRequest,
  ProviderOrderResponse,
  ProviderSymbolInfo,
} from '../execution-provider.types'
import { ProviderError } from '../execution-provider.types'

// Deliberately inert. This is what `NODE_ENV=production` resolves to in
// Phase 6F (see execution-provider.factory.ts) — NOT a thrown error at
// module-initialization time. Throwing there would take down the entire
// application (deposits, withdrawals, CMS, support, everything else Nest
// boots in the same process), which is a far larger blast radius than "no
// production authorization mechanism exists yet for execution." Instead,
// the application boots normally in every environment, and this provider
// makes execution itself categorically unusable: every action-taking
// method throws PROVIDER_UNAVAILABLE; healthCheck() honestly reports
// executionAvailable: false rather than pretending to be healthy.
export class DisabledExecutionProvider implements ExecutionProvider {
  readonly name = 'Disabled'

  private fail(): never {
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'Execution is disabled in this environment — no production authorization mechanism exists yet (Phase 6F).',
      false,
    )
  }

  async getMarketStatus(_providerSymbol: string): Promise<ProviderMarketStatus> {
    this.fail()
  }
  async getSymbolInfo(_providerSymbol: string): Promise<ProviderSymbolInfo> {
    this.fail()
  }
  async submitMarketOrder(_request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    this.fail()
  }
  async submitLimitOrder(_request: ProviderOrderRequest): Promise<ProviderOrderResponse> {
    this.fail()
  }
  async getOrderStatus(_query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    this.fail()
  }
  async getOrderFills(_query: ProviderOrderQuery): Promise<ProviderFill[]> {
    this.fail()
  }
  async cancelOrder(_query: ProviderOrderQuery): Promise<ProviderOrderResponse> {
    this.fail()
  }
  async getAccountBalances(): Promise<ProviderBalance[]> {
    this.fail()
  }
  async getOpenOrders(_providerSymbol?: string): Promise<ProviderOrderResponse[]> {
    this.fail()
  }

  async healthCheck(): Promise<ExecutionProviderHealth> {
    return {
      provider: this.name,
      environment: 'production',
      connectivity: 'unknown',
      marketDataAvailable: false,
      executionAvailable: false,
      checkedAt: new Date().toISOString(),
      detail: 'Execution is disabled in this environment — no production authorization mechanism exists yet (Phase 6F).',
    }
  }
}
