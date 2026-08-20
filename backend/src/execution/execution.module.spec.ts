import { Test } from '@nestjs/testing'
import { ExecutionModule, EXECUTION_PROVIDER } from './execution.module'
import { FakeExecutionProvider } from './providers/fake-execution.provider'
import { DisabledExecutionProvider } from './providers/disabled-execution.provider'

// Step 15 security tests, run against a REAL NestJS DI container (not just
// the pure factory function directly — execution-provider.factory.spec.ts
// already covers that) — proves the module actually wires the safety gate
// the way the app will experience it at boot. No PostgreSQL is needed:
// ExecutionModule has no database dependency, so this runs as a fast unit
// test rather than needing the disposable e2e Postgres instance.
describe('ExecutionModule — real NestJS DI wiring', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('1. boots successfully under NODE_ENV=test with no EXECUTION_PROVIDER set, resolving to FakeExecutionProvider', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.EXECUTION_PROVIDER
    const moduleRef = await Test.createTestingModule({ imports: [ExecutionModule] }).compile()
    const provider = moduleRef.get(EXECUTION_PROVIDER)
    expect(provider).toBeInstanceOf(FakeExecutionProvider)
    await moduleRef.close()
  })

  it('2. the module-resolved EXECUTION_PROVIDER and the directly-injected FakeExecutionProvider are the SAME instance', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.EXECUTION_PROVIDER
    const moduleRef = await Test.createTestingModule({ imports: [ExecutionModule] }).compile()
    expect(moduleRef.get(EXECUTION_PROVIDER)).toBe(moduleRef.get(FakeExecutionProvider))
    await moduleRef.close()
  })

  it('3. production NEVER lets the module fail to compile, and NEVER resolves a live provider — it resolves to DisabledExecutionProvider', async () => {
    process.env.NODE_ENV = 'production'
    process.env.EXECUTION_PROVIDER = 'BINANCE_SANDBOX'
    process.env.BINANCE_SANDBOX_API_KEY = 'would-be-real-key'
    process.env.BINANCE_SANDBOX_API_SECRET = 'would-be-real-secret'
    const moduleRef = await Test.createTestingModule({ imports: [ExecutionModule] }).compile()
    const provider = moduleRef.get(EXECUTION_PROVIDER)
    expect(provider).toBeInstanceOf(DisabledExecutionProvider)
    await moduleRef.close()
  })

  it('4. requesting BINANCE_PRODUCTION under NODE_ENV=test makes the module FAIL TO COMPILE — the whole app cannot boot with a production provider requested outside production', async () => {
    process.env.NODE_ENV = 'test'
    process.env.EXECUTION_PROVIDER = 'BINANCE_PRODUCTION'
    await expect(Test.createTestingModule({ imports: [ExecutionModule] }).compile()).rejects.toThrow(/BINANCE_PRODUCTION/)
  })

  it('5. requesting BINANCE_PRODUCTION under NODE_ENV=development also fails to compile', async () => {
    process.env.NODE_ENV = 'development'
    process.env.EXECUTION_PROVIDER = 'BINANCE_PRODUCTION'
    await expect(Test.createTestingModule({ imports: [ExecutionModule] }).compile()).rejects.toThrow(/BINANCE_PRODUCTION/)
  })

  it('6. requesting BINANCE_SANDBOX with no credentials under NODE_ENV=test makes the module fail to compile — fails closed, no silent fallback', async () => {
    process.env.NODE_ENV = 'test'
    process.env.EXECUTION_PROVIDER = 'BINANCE_SANDBOX'
    delete process.env.BINANCE_SANDBOX_API_KEY
    delete process.env.BINANCE_SANDBOX_API_SECRET
    await expect(Test.createTestingModule({ imports: [ExecutionModule] }).compile()).rejects.toThrow(/requires BINANCE_SANDBOX_API_KEY/)
  })

  it('7. staging with no EXECUTION_PROVIDER set fails to compile — no implicit default outside development/test', async () => {
    process.env.NODE_ENV = 'staging'
    delete process.env.EXECUTION_PROVIDER
    await expect(Test.createTestingModule({ imports: [ExecutionModule] }).compile()).rejects.toThrow(/explicitly set in staging/)
  })

  it('8. healthCheck() on the resolved provider never includes the configured credential values', async () => {
    process.env.NODE_ENV = 'test'
    process.env.EXECUTION_PROVIDER = 'BINANCE_SANDBOX'
    process.env.BINANCE_SANDBOX_API_KEY = 'super-secret-test-key-should-never-leak'
    process.env.BINANCE_SANDBOX_API_SECRET = 'super-secret-test-secret-should-never-leak'
    const originalFetch = global.fetch
    global.fetch = jest.fn().mockRejectedValue(new Error('network unreachable in unit test')) as any
    try {
      const moduleRef = await Test.createTestingModule({ imports: [ExecutionModule] }).compile()
      const provider = moduleRef.get(EXECUTION_PROVIDER)
      const health = await provider.healthCheck()
      const serialized = JSON.stringify(health)
      expect(serialized).not.toContain('super-secret-test-key-should-never-leak')
      expect(serialized).not.toContain('super-secret-test-secret-should-never-leak')
      await moduleRef.close()
    } finally {
      global.fetch = originalFetch
    }
  })
})
