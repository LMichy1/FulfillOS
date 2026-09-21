import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '../database/schema';
import type { Database, DbTransaction } from '../database/database.module';
import {
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorConstraint,
} from '../common/pg-error.util';
import type { OperationOutcome } from '../common/operation-outcome.util';

const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'idempotency_keys_org_operation_key_key';

export interface IdempotencyRequest {
  organizationId: string;
  operation: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

/**
 * Thrown by `claimIdempotencyKey` when another request already holds this
 * (organizationId, operation, idempotencyKey). Postgres aborts a transaction on any error
 * inside it, so this must propagate out of `db.transaction(...)` unmodified — do not catch it
 * and keep issuing statements on the same `tx`. Once the transaction has rolled back, resolve
 * it with `resolveIdempotencyConflict` using the outer, non-transactional `db`.
 */
export class IdempotencyKeyClaimedError extends Error {
  constructor() {
    super('Idempotency key already claimed by another request.');
    this.name = 'IdempotencyKeyClaimedError';
  }
}

/**
 * Claims (organizationId, operation, idempotencyKey) by inserting an `in_progress` row. Must
 * be the first statement inside the transaction that performs the guarded operation: the
 * unique constraint on `idempotency_keys` is what makes a concurrent duplicate impossible to
 * miss — there is no separate "does a row exist?" check that a race could slip through.
 */
export async function claimIdempotencyKey(
  tx: DbTransaction,
  request: IdempotencyRequest,
): Promise<void> {
  try {
    await tx.insert(idempotencyKeys).values({
      organizationId: request.organizationId,
      operation: request.operation,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.requestFingerprint,
      state: 'in_progress',
    });
  } catch (error) {
    if (
      pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
      pgErrorConstraint(error) === IDEMPOTENCY_UNIQUE_CONSTRAINT
    ) {
      throw new IdempotencyKeyClaimedError();
    }
    throw error;
  }
}

/**
 * Marks the claimed row `completed` with the operation's outcome — called as the last
 * statement before the transaction commits, so the idempotency result and the business
 * write (or business rejection) become durable atomically. A clean rejection (see
 * `OperationOutcome`) is recorded here too: it is a completed, replayable result, not a
 * failure of the idempotency mechanism itself.
 */
export async function completeIdempotencyKey<T>(
  tx: DbTransaction,
  request: IdempotencyRequest,
  outcome: OperationOutcome<T>,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({
      state: 'completed',
      responseStatus: outcome.status,
      responseBody: outcome.body,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(idempotencyKeys.organizationId, request.organizationId),
        eq(idempotencyKeys.operation, request.operation),
        eq(idempotencyKeys.idempotencyKey, request.idempotencyKey),
      ),
    );
}

/**
 * Resolves an `IdempotencyKeyClaimedError` after the transaction that threw it has rolled
 * back, by reading (on a fresh connection, not the aborted `tx`) whichever row won the race:
 *
 * - Different fingerprint for the same key -> reject as a conflict; nothing replayed.
 * - Same fingerprint, `completed` -> replay the original outcome verbatim (this is the normal
 *   "client retried the exact same request" path).
 * - Same fingerprint, `in_progress` -> another request is still processing; reject as a
 *   conflict rather than guessing at a result that doesn't exist yet.
 * - No row found -> the winning transaction itself rolled back between our conflicting insert
 *   and this read (a narrow window); reject as a conflict — safe for the client to retry.
 */
export async function resolveIdempotencyConflict<T>(
  db: Database,
  request: IdempotencyRequest,
): Promise<OperationOutcome<T>> {
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, request.organizationId),
        eq(idempotencyKeys.operation, request.operation),
        eq(idempotencyKeys.idempotencyKey, request.idempotencyKey),
      ),
    );

  if (!existing) {
    return {
      ok: false,
      status: 409,
      body: {
        message:
          'This idempotency key was briefly claimed by another request that did not complete. Retry the request.',
      },
    };
  }

  if (existing.requestFingerprint !== request.requestFingerprint) {
    return {
      ok: false,
      status: 409,
      body: {
        message:
          'This idempotency key was already used for a request with a different payload.',
      },
    };
  }

  if (existing.state === 'completed') {
    const status = existing.responseStatus ?? 500;
    const body = existing.responseBody as unknown;
    if (status < 400) {
      return { ok: true, status, body: body as T };
    }
    return {
      ok: false,
      status,
      body: body as { message: string; [key: string]: unknown },
    };
  }

  return {
    ok: false,
    status: 409,
    body: {
      message:
        'A request with this idempotency key is still in progress. Retry shortly.',
    },
  };
}
