import { createExecutionProvider } from './execution-provider.factory'
import { FakeExecutionProvider } from './providers/fake-execution.provider'
import { DisabledExecutionProvider } from './providers/disabled-execution.provider'
import { BinanceSandboxProvider } from './providers/binance-sandbox.provider'

// Step 8/15 — the environment safety gate is the single most important
// property in Checkpoint B. Every one of these is a hard requirement, not
// a nice-to-have: a mistake here is the difference between a sandbox test
// run and an accidental production order.
describe('createExecutionProvider — environment safety gate', () => {
  it('1. production NEVER constructs a real/live provider — it gets an inert DisabledExecutionProvider, regardless of what was requested', () => {
    for (const requested of [undefined, 'FAKE', 'BINANCE_SANDBOX', 'BINANCE_PRODUCTION']) {
      const provider = createExecutionProvider({ nodeEnv: 'production', requestedProvider: requested })
      expect(provider).toBeInstanceOf(DisabledExecutionProvider)
    }
  })

  it('2. production provider construction does not throw (so the rest of the app can still boot) — it degrades to Disabled instead', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'production', requestedProvider: 'BINANCE_SANDBOX', binanceSandboxApiKey: 'x', binanceSandboxApiSecret: 'y' })).not.toThrow()
  })

  it('3. BINANCE_PRODUCTION can never be constructed in development', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'development', requestedProvider: 'BINANCE_PRODUCTION' })).toThrow(/BINANCE_PRODUCTION/)
  })

  it('4. BINANCE_PRODUCTION can never be constructed in test', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'test', requestedProvider: 'BINANCE_PRODUCTION' })).toThrow(/BINANCE_PRODUCTION/)
  })

  it('5. BINANCE_PRODUCTION can never be constructed in staging', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'staging', requestedProvider: 'BINANCE_PRODUCTION' })).toThrow(/BINANCE_PRODUCTION/)
  })

  it('6. development with no EXECUTION_PROVIDER set defaults to FAKE — a safe default, not an ambiguous one', () => {
    const provider = createExecutionProvider({ nodeEnv: 'development', requestedProvider: undefined })
    expect(provider).toBeInstanceOf(FakeExecutionProvider)
  })

  it('7. test with no EXECUTION_PROVIDER set defaults to FAKE', () => {
    const provider = createExecutionProvider({ nodeEnv: 'test', requestedProvider: undefined })
    expect(provider).toBeInstanceOf(FakeExecutionProvider)
  })

  it('8. staging with no EXECUTION_PROVIDER set FAILS CLOSED — no implicit default, unlike development/test', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'staging', requestedProvider: undefined })).toThrow(/explicitly set in staging/)
  })

  it('9. BINANCE_SANDBOX with missing credentials fails closed — never silently substitutes FAKE or any other provider', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'test', requestedProvider: 'BINANCE_SANDBOX' })).toThrow(/requires BINANCE_SANDBOX_API_KEY/)
    expect(() => createExecutionProvider({ nodeEnv: 'test', requestedProvider: 'BINANCE_SANDBOX', binanceSandboxApiKey: 'only-key' })).toThrow(/requires BINANCE_SANDBOX_API_KEY/)
  })

  it('10. BINANCE_SANDBOX with real credentials constructs a genuine BinanceSandboxProvider in development/test/staging', () => {
    for (const nodeEnv of ['development', 'test', 'staging'] as const) {
      const provider = createExecutionProvider({ nodeEnv, requestedProvider: 'BINANCE_SANDBOX', binanceSandboxApiKey: 'k', binanceSandboxApiSecret: 's' })
      expect(provider).toBeInstanceOf(BinanceSandboxProvider)
    }
  })

  it('11. an unrecognized EXECUTION_PROVIDER value throws a clear, specific error rather than silently defaulting', () => {
    expect(() => createExecutionProvider({ nodeEnv: 'test', requestedProvider: 'totally-bogus' })).toThrow(/Unrecognized EXECUTION_PROVIDER/)
  })

  it('12. explicitly requesting FAKE always works in development/test/staging', () => {
    for (const nodeEnv of ['development', 'test', 'staging'] as const) {
      expect(createExecutionProvider({ nodeEnv, requestedProvider: 'FAKE' })).toBeInstanceOf(FakeExecutionProvider)
    }
  })

  it('13. the SAME injected FakeExecutionProvider instance is returned, not a fresh one, when supplied (so DI consumers and tests share state)', () => {
    const shared = new FakeExecutionProvider()
    const resolved = createExecutionProvider({ nodeEnv: 'test', requestedProvider: 'FAKE', fakeProviderInstance: shared })
    expect(resolved).toBe(shared)
  })

  it('14. case-insensitive / whitespace-tolerant provider name parsing does not weaken any safety check', () => {
    expect(createExecutionProvider({ nodeEnv: 'test', requestedProvider: ' fake ' })).toBeInstanceOf(FakeExecutionProvider)
    expect(() => createExecutionProvider({ nodeEnv: 'test', requestedProvider: ' binance_production ' })).toThrow(/BINANCE_PRODUCTION/)
  })
})
