import { HttpException } from '@nestjs/common';

/**
 * A business-logic result that must be decided *inside* a database transaction (so it can
 * commit atomically with an idempotency record — see
 * docs/architecture/inventory.md#idempotency) but only translated into a thrown HTTP
 * exception *after* that transaction has committed. A clean, expected rejection (insufficient
 * stock, invalid state transition) is `ok: false` — a normal return value, not a thrown error —
 * so the transaction still commits (recording the rejection for idempotent replay) instead of
 * rolling back. Only genuinely unexpected failures should throw and roll back the transaction.
 */
export type OperationOutcome<T> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      status: number;
      body: { message: string; [key: string]: unknown };
    };

/** Converts an `OperationOutcome` into its success value, or throws the equivalent
 * `HttpException` for a rejection — for use once the transaction that produced it has
 * already committed. */
export function unwrapOutcome<T>(outcome: OperationOutcome<T>): T {
  if (!outcome.ok) {
    throw new HttpException(outcome.body, outcome.status);
  }
  return outcome.body;
}
