/**
 * drizzle-orm wraps the underlying pg driver error in a DrizzleQueryError, with the original
 * error (which carries the Postgres SQLSTATE `.code`) attached as `.cause`. This unwraps
 * either shape so callers can branch on the specific constraint violation rather than
 * catching "any error".
 */
export function pgErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code ?? (error as { code?: string } | undefined)?.code;
}

/** The name of the constraint that failed (e.g. `idempotency_keys_org_operation_key_key`),
 * when the driver reports one — lets a caller distinguish "this unique violation is the
 * idempotency guard doing its job" from an unrelated constraint failing for some other
 * reason, rather than assuming any 23505 means an idempotency conflict. */
export function pgErrorConstraint(error: unknown): string | undefined {
  const cause = (error as { cause?: { constraint?: string } } | undefined)
    ?.cause;
  return (
    cause?.constraint ??
    (error as { constraint?: string } | undefined)?.constraint
  );
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_NOT_NULL_VIOLATION = '23502';
/** Transaction-level failures where PostgreSQL guarantees the whole transaction was rolled
 * back atomically — the only failure classes safe to retry automatically (see
 * docs/architecture/inventory.md#deadlock-handling). Never retry on anything else: a dropped
 * connection or an ambiguous error leaves the outcome unknown, and blindly retrying could
 * double-apply a side effect that actually committed. */
export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';
