import { ConflictException, Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'

export interface IdempotentRunParams {
  userId: string
  // Namespaces the key per endpoint (e.g. "deposits.create") so the same
  // key value reused across different endpoints — or by different users —
  // can never collide or share state. See @@unique([userId, scope, key]).
  scope: string
  key: string | undefined
  requestPayload: unknown
}

/**
 * Reusable client-supplied idempotency mechanism (Phase 2.1) for endpoints
 * that create a financial record — deposits, withdrawals, orders today, any
 * future one tomorrow, all through this one service rather than three
 * bespoke implementations.
 *
 * Design: a PostgreSQL transaction-scoped advisory lock
 * (`pg_advisory_xact_lock`, same primitive LedgerService already uses) is
 * held for the ENTIRE duration of the wrapped operation, not just the
 * bookkeeping step. A concurrent second caller with the identical
 * (userId, scope, key) blocks at lock acquisition until the first caller's
 * transaction fully commits, then finds the already-COMPLETED row and
 * replays its stored response — there is no window where two callers can
 * both decide to run the operation. This is what makes "concurrent
 * requests, same key -> exactly one financial effect" true by construction.
 *
 * A key reused with materially different request parameters (detected via
 * a hash of the request body) is rejected with 409, never silently
 * treated as a fresh operation or as a replay of the wrong one.
 *
 * Calling with no key at all (key === undefined) preserves the exact
 * pre-existing behavior — no dedup, operation runs every time — so this is
 * purely additive for clients that don't send the header.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(params: IdempotentRunParams, operation: () => Promise<T>): Promise<T> {
    const { userId, scope, key, requestPayload } = params
    if (!key) return operation()

    const requestHash = hashRequest(requestPayload)
    const lockKey = `idempotency:${userId}:${scope}:${key}`

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

        const existing = await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        })

        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictException('This Idempotency-Key was already used with different request parameters.')
          }
          if (existing.status === 'PROCESSING') {
            // Not reachable in normal operation: the advisory lock above
            // means no committed row can exist in PROCESSING state (it only
            // exists mid-transaction, before either COMPLETED or a
            // rollback). Kept as a conservative guard, not a real code path.
            throw new ConflictException('This request is already being processed. Please retry shortly.')
          }
          return existing.responseBody as T
        }

        const claim = await tx.idempotencyKey.create({
          data: { userId, scope, key, requestHash, status: 'PROCESSING' },
        })

        let result: T
        try {
          result = await operation()
        } catch (err) {
          // Roll back the claim too (same transaction) so a genuine retry
          // after a failed attempt starts fresh instead of being stuck.
          await tx.idempotencyKey.delete({ where: { id: claim.id } })
          throw err
        }

        // A plain-JSON snapshot of exactly what the caller receives over
        // HTTP (Decimal/Date fields serialize the same way res.json() would)
        // — a replay returns byte-for-byte what the original call returned.
        const responseSnapshot = JSON.parse(JSON.stringify(result))
        await tx.idempotencyKey.update({
          where: { id: claim.id },
          data: { status: 'COMPLETED', responseBody: responseSnapshot, completedAt: new Date() },
        })

        return result
      },
      { timeout: 20_000 },
    )
  }
}

function hashRequest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}
