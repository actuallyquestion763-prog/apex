import type { AppEnv } from '../config/env.validation'
import type { ExecutionProvider } from './execution-provider.types'
import { FakeExecutionProvider } from './providers/fake-execution.provider'
import { BinanceSandboxProvider } from './providers/binance-sandbox.provider'
import { DisabledExecutionProvider } from './providers/disabled-execution.provider'

// Step 8 — the ONE place that decides which ExecutionProvider a running
// process gets. Every safety rule from Step 6/8 is enforced HERE, not
// hoped for at the call site: business logic never picks a provider, it
// only ever receives whatever this factory decided was safe to construct.
export type ExecutionProviderKind = 'FAKE' | 'BINANCE_SANDBOX' | 'BINANCE_PRODUCTION'

export interface ExecutionProviderFactoryConfig {
  nodeEnv: AppEnv
  requestedProvider: string | undefined // raw process.env.EXECUTION_PROVIDER, unvalidated
  binanceSandboxApiKey?: string
  binanceSandboxApiSecret?: string
  // Supplied by ExecutionModule so DI consumers and test code share the
  // exact same FakeExecutionProvider instance when FAKE is selected —
  // never constructed fresh here unless the caller genuinely didn't supply
  // one (e.g. a standalone unit test of this factory).
  fakeProviderInstance?: FakeExecutionProvider
}

export function createExecutionProvider(config: ExecutionProviderFactoryConfig): ExecutionProvider {
  // Step 6: production must never construct a real/live provider. Unlike
  // every other rule in this factory, this one deliberately does NOT throw
  // — see disabled-execution.provider.ts for why (throwing here would take
  // down the entire application's boot, not just execution). The app boots
  // normally; execution itself is simply unusable.
  if (config.nodeEnv === 'production') {
    return new DisabledExecutionProvider()
  }

  const kind = resolveKind(config)

  switch (kind) {
    case 'FAKE':
      return config.fakeProviderInstance ?? new FakeExecutionProvider()

    case 'BINANCE_SANDBOX': {
      if (!config.binanceSandboxApiKey || !config.binanceSandboxApiSecret) {
        throw new Error(
          'EXECUTION_PROVIDER=BINANCE_SANDBOX requires BINANCE_SANDBOX_API_KEY and BINANCE_SANDBOX_API_SECRET to be set. ' +
            'Fail closed — no other provider is silently substituted.',
        )
      }
      return new BinanceSandboxProvider({ apiKey: config.binanceSandboxApiKey, apiSecret: config.binanceSandboxApiSecret })
    }

    case 'BINANCE_PRODUCTION':
      // Deliberately unreachable in this phase — resolveKind() throws
      // before returning this kind under every current NODE_ENV, and no
      // "BinanceProductionProvider" class exists anywhere in this codebase.
      // This branch exists only so the shape of a future production
      // authorization gate is visible in the type, not so it can run.
      throw new Error(
        'Production execution is not implemented in Phase 6F. There is no production provider class, no production credentials, ' +
          'and no authorization mechanism — this is intentional, not a bug. See the Phase 6F Checkpoint B report.',
      )
  }
}

// Only ever called for nodeEnv !== 'production' — createExecutionProvider()
// returns a DisabledExecutionProvider for production before this runs.
function resolveKind(config: ExecutionProviderFactoryConfig): ExecutionProviderKind {
  const { nodeEnv, requestedProvider } = config

  if (requestedProvider === undefined || requestedProvider.trim() === '') {
    if (nodeEnv === 'staging') {
      // Staging is close enough to a real deployment that an *implicit*
      // choice is exactly the ambiguity Step 6 says to fail closed on —
      // development/test get a safe FAKE default (see below) precisely
      // because FAKE touches nothing external; staging does not get that
      // same free pass.
      throw new Error('EXECUTION_PROVIDER must be explicitly set in staging (FAKE or BINANCE_SANDBOX) — refusing to assume a default. Fail closed.')
    }
    // development/test: default to FAKE. This is not a dangerous silent
    // fallback (Step 6 forbids falling back from sandbox to production,
    // not defaulting an entirely-unconfigured dev/test process to the
    // provider that cannot touch any real system).
    return 'FAKE'
  }

  const normalized = requestedProvider.trim().toUpperCase()
  if (normalized !== 'FAKE' && normalized !== 'BINANCE_SANDBOX' && normalized !== 'BINANCE_PRODUCTION') {
    throw new Error(`Unrecognized EXECUTION_PROVIDER "${requestedProvider}". Valid values: FAKE, BINANCE_SANDBOX, BINANCE_PRODUCTION.`)
  }

  if (normalized === 'BINANCE_PRODUCTION') {
    // Never permitted outside a future, explicitly-authorized production
    // phase — not in development, not in test, not in staging, regardless
    // of any other environment variable. There is no flag anywhere in this
    // codebase that changes this outcome.
    throw new Error(`EXECUTION_PROVIDER=BINANCE_PRODUCTION cannot be constructed in ${nodeEnv}. Fail closed.`)
  }

  return normalized as ExecutionProviderKind
}
