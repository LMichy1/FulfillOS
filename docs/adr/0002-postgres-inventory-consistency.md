# ADR-002: PostgreSQL Inventory Consistency Strategy

## Status

Accepted

## Context

Inventory reservation is the core correctness challenge of FulfillOS: concurrent orders must never reserve more stock than is on hand, and duplicate or retried requests must not double-reserve or double-release stock.

## Decision

- PostgreSQL is the single source of truth for `on_hand` and `reserved` quantities. Redis is not used to store or arbitrate inventory state.
- Every reservation and release runs inside a database transaction that takes a row-level lock (`SELECT ... FOR UPDATE`) on the affected inventory row(s) before reading or mutating quantities.
- For multi-item orders, inventory rows are locked in a deterministic order (ascending product id) to prevent lock-ordering deadlocks between concurrent transactions.
- Database `CHECK` constraints enforce `on_hand >= 0`, `reserved >= 0`, and `on_hand - reserved >= 0` as a backstop against application bugs, not as the primary mechanism.
- Idempotency keys are stored in a Postgres table, unique per `(organization_id, idempotency_key)`, so a retried request with the same key and payload returns the original result, and a retried request with the same key but a different payload is rejected with a conflict.

## Alternatives considered

- **Optimistic concurrency (version column, retry on conflict)**: rejected as the primary mechanism. Under contention for the last unit of stock, optimistic retries add latency and complexity without a correctness advantage over locking for this workload's write patterns; row-level locking gives a simpler, easier-to-reason-about guarantee.
- **Read-then-write check in application code without locking**: rejected outright — this is a classic TOCTOU race and cannot prevent overselling under concurrent requests.
- **Redis-based counters (e.g. `DECR`) for available stock**: rejected. Redis would become a second source of truth that can drift from Postgres on partial failures, and the spec requires Postgres as the authoritative store for critical business data.

## Consequences

- Correctness under concurrency is provable with integration tests against a real Postgres instance (two concurrent orders competing for the last unit, etc.).
- Row-level locking can serialize writes to a hot inventory row under heavy concurrent load on the same product; this is an accepted trade-off for correctness at the MVP's expected scale.
- Deterministic lock ordering adds a small amount of complexity to multi-item order processing but is necessary to avoid deadlocks.

## Addendum (Milestone 3, implementation)

This decision was implemented as designed, with two clarifications the original text left
implicit. Recorded here rather than editing the Decision above, per this project's policy of
not silently rewriting historical decisions.

- **Isolation level**: transactions run at PostgreSQL's default READ COMMITTED, not
  SERIALIZABLE. The row lock, not the isolation level, is what provides the correctness
  guarantee here (every transaction that touches an `inventory` row locks it with
  `FOR UPDATE` before reading or writing it) — see
  [docs/architecture/inventory.md#isolation-level](../architecture/inventory.md#isolation-level)
  for the full reasoning.
- **Idempotency key uniqueness**: the actual schema (Milestone 1) scopes the unique constraint
  as `(organization_id, operation, idempotency_key)` — operation-scoped in addition to
  tenant-scoped — rather than the `(organization_id, idempotency_key)` stated above. This is a
  refinement, not a contradiction: it lets the same key value be reused (safely, with distinct
  rows) across different operations without an artificial namespacing convention in
  application code.

No other aspect of the original decision changed: reservation and release still use row-level
locks in ascending `product_id` order inside one transaction each, and PostgreSQL remains the
only store for `on_hand`/`reserved`.
