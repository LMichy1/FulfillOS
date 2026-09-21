# Inventory and Reservation Engine

## Status

Implemented and tested as of Milestone 3: stock adjustments, atomic multi-product
reservations, transactional idempotency, and reservation release/cancellation, all served
through the tenant-scoped HTTP API below. This document describes what is actually built and
verified — see [Known limitations](#known-limitations) for what is explicitly deferred.

## Data model

No new tables were introduced this milestone. Every piece of the reservation engine reuses
tables Milestone 1 already defined (see [database.md](database.md) for the full schema):

| Table                 | Role in this milestone                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| `inventory`           | The authoritative `on_hand`/`reserved` counters, one row per product.                |
| `inventory_movements` | Append-only ledger: one row per stock change, written in the same transaction.       |
| `orders`              | The reservation record itself — see [Reservation lifecycle](#reservation-lifecycle). |
| `order_items`         | The reserved line items, with a price snapshot at reservation time.                  |
| `idempotency_keys`    | Backs the idempotency mechanism — see [Idempotency](#idempotency).                   |
| `audit_log`           | One entry per reservation creation and release.                                      |

PostgreSQL remains the sole source of truth for `on_hand` and `reserved`. Redis is not used to
store, cache, or arbitrate any inventory quantity — nothing in this milestone reads or writes
inventory state through Redis.

## Invariants

```
on_hand   >= 0
reserved  >= 0
reserved  <= on_hand
available = on_hand - reserved
```

These are the same four invariants stated in the Milestone 1 schema and enforced there as
`CHECK` constraints (see [database.md#inventory-invariants](database.md#inventory-invariants)).
This milestone's application layer treats them as a backstop, not the primary mechanism: every
write path validates them itself first, returning a clean 4xx before a constraint violation
would ever reach Postgres. `available` is never stored and never accepted as client input — it
is computed as `on_hand - reserved` at read time, every time (`InventoryService.listInventory`,
`InventoryService.adjustStock`), so it can never itself drift out of sync.

Integer overflow is checked in the application layer against PostgreSQL's 4-byte `integer`
bounds (`common/postgres-int.util.ts`) before any adjustment is applied — a computed
`on_hand` that would exceed `2147483647` is rejected with `422`, rather than surfacing as an
opaque Postgres error.

## Transaction boundaries and lock order

Every write that touches `inventory` — a stock adjustment, a reservation, or a release — runs
inside exactly one PostgreSQL transaction, opened with `db.transaction(async (tx) => ...)`
(`drizzle-orm`'s `node-postgres` transaction API). No stock validation or update ever happens
as two separate, unrelated statements outside a shared transaction, and no transaction is ever
held open across an external network call — every statement inside one is a query against the
same Postgres connection.

For a multi-product reservation, the affected `inventory` rows are locked with
`SELECT ... FOR UPDATE` (via `.for('update', { of: inventory })`, which locks only the
`inventory` rows, not the `products` rows joined in for pricing) in **ascending `product_id`
order**, regardless of the order the client listed them in the request
(`ReservationsService.reserveStock` re-sorts via `ORDER BY product_id ASC` before locking).
This is what prevents a deadlock between two concurrent multi-product reservations that name
the same two products in opposite order: both transactions always acquire the lower-id row
first, so neither can end up waiting on a lock the other already holds while holding a lock the
other is waiting for. This is verified directly — see
[reservations.integration-spec.ts](../../apps/api/test/integration/reservations.integration-spec.ts)'s
opposite-order test, which fires two such reservations concurrently and asserts both succeed
without timing out.

Release reverses this same lock order over the order's existing `order_items`.

## Isolation level

Reservation and release transactions are run at PostgreSQL's default **READ COMMITTED**
isolation level, combined with explicit `SELECT ... FOR UPDATE` row locks. This is a deliberate
choice, not an oversight: the correctness property this engine needs — "never let two
transactions both believe they've reserved the last unit" — is provided by the row lock itself,
not by the isolation level. A `FOR UPDATE` lock forces a second transaction wanting the same
row to block until the first commits or rolls back, and then to re-read the row's _current_
values (which is exactly what happens here, since the stock check happens after the lock is
acquired, never before). `SERIALIZABLE` would add retry-on-conflict complexity (and real retry
latency under contention) without buying additional correctness for this specific access
pattern, where every transaction that touches a given inventory row explicitly locks it before
reading or writing.

## Deadlock and serialization-failure handling

Deterministic lock ordering (above) is the primary defense against deadlocks — with it, a
classic circular-wait between two multi-row reservation transactions cannot occur. PostgreSQL
can still, in principle, report `deadlock_detected` (SQLSTATE `40P01`) or
`serialization_failure` (`40001`) in edge cases (e.g. interaction with an unrelated concurrent
transaction on the same rows). Both codes are defined in `common/pg-error.util.ts` for exactly
this reason, but this milestone does **not** wrap reservation/release calls in an automatic
retry loop: everywhere a transaction is retried, it must be a whole-transaction retry (re-run
every statement from the start, on a fresh transaction) and only for these two unambiguous,
whole-transaction-rolled-back failure codes — never for an ambiguous outcome like a dropped
connection, where whether the transaction committed is genuinely unknown and blindly retrying
could double-apply a side effect. No code path in this milestone has hit this case in testing
(the deterministic lock order avoids it structurally for the scenarios exercised), so no retry
loop has been added; the constants exist so a future caller that does need one has the correct
codes to check, and this reasoning is written down so no one adds a blanket retry-on-any-error
loop later.

## Idempotency

The idempotency mechanism (`idempotency/idempotency.util.ts`) is a single, shared
implementation used by stock adjustments, reservation creation, and reservation release alike.
It is keyed by `(organization_id, operation, idempotency_key)` — tenant-scoped and
operation-scoped, per the Milestone 1 schema's unique constraint — plus a canonical fingerprint
of the request body (`common/canonical-json.util.ts`: a stable, key-sorted JSON serialization,
SHA-256 hashed).

The sequence, run as the first and last statements inside the guarded transaction:

1. **Claim**: insert a `state = 'in_progress'` row. This is the _only_ place a duplicate is
   detected — there is no separate "does a row exist?" check that a race could slip through;
   the database's own unique constraint is the arbiter.
2. **Do the work**: the actual business logic (adjust stock / reserve / release), producing an
   `OperationOutcome` — either a success or a _clean, expected_ rejection (insufficient stock,
   invalid state transition). Both are ordinary return values, not thrown errors.
3. **Complete**: update the same row to `state = 'completed'` with the outcome's status and
   body.

Because steps 1–3 are one transaction, they commit or roll back together:

- **A clean rejection still commits.** Insufficient stock is a fact about that specific
  request at that moment, and it's recorded as a completed, replayable result — a retry with
  the same key and payload gets the same rejection every time, rather than silently re-running
  business logic against now-different state. (This is deliberate: an idempotency key
  represents "this exact client-intended attempt", not "keep trying until it works".)
- **A genuinely unexpected error rolls everything back**, including the claim itself. Nothing
  is left behind, so a legitimate retry with the same key later is treated as a fresh attempt —
  this is what prevents an ambiguous crash from permanently wedging a key.

**Concurrent requests with the same key**: PostgreSQL's own unique-index handling does the
serializing. A second transaction's claim-insert blocks until the first transaction commits or
rolls back, then either succeeds (if the first rolled back — treated as a fresh attempt) or
fails with a unique violation (if the first committed). In the latter case, the
now-aborted transaction is allowed to roll back, and a fresh, non-transactional read
(`resolveIdempotencyConflict`) decides the response:

- Different fingerprint for the same key → `409`, no replay (the key was reused for a
  different request).
- Same fingerprint, row now `completed` → replay the original outcome verbatim. Because the
  losing transaction's insert only unblocks _after_ the winner has committed, this is the
  overwhelmingly common case for two requests submitted at nearly the same instant — verified
  directly in
  [reservation-idempotency.integration-spec.ts](../../apps/api/test/integration/reservation-idempotency.integration-spec.ts),
  which fires two truly concurrent identical (and separately, two conflicting) requests and
  asserts exactly one order is created either way.
- Same fingerprint, row still `in_progress` → `409` (a request is still being processed; there
  is nothing yet to replay).
- No row found at all → `409` (a narrow race where the winning transaction itself rolled back
  between the conflict and this read); safe for the client to retry.

**Interrupted requests and rollbacks**: covered above — an unexpected failure rolls back the
claim along with everything else, so it never permanently blocks a retry.
**Expired keys**: `idempotency_keys.expires_at` documents an intended 24-hour retention window
(inherited from Milestone 1's schema); no expiry/cleanup job exists yet — see
[Known limitations](#known-limitations).

## Reservation lifecycle

The milestone brief suggested a `CREATED` / `RESERVED` / `CANCELLED` state model. Milestone 1's
schema already defines `orders.status` as `pending` / `fulfilled` / `cancelled`
(`order-status` enum), so this milestone adopts that existing model instead of introducing a
parallel one:

- **An order _is_ the reservation.** Creating a reservation means creating an `orders` row
  (`status = 'pending'`) plus one `order_items` row per line, atomically with the
  `inventory.reserved` increments that back it. There is no separate `reservations` table.
- **`pending` means "reserved".** The order exists, its items are recorded, and the
  corresponding stock is held in `inventory.reserved`.
- **`pending` → `cancelled` is release.** Covered below.
- **`pending` → `fulfilled`** (consuming the reservation permanently — decrementing `on_hand`
  as well as `reserved`) is explicitly **out of scope for this milestone** — no fulfillment
  workflow exists yet, matching the schema comment's original intent
  (`orders.schema.ts`: "inventory reservation is consumed, not released"). This milestone only
  builds `pending` and `pending → cancelled`.
- `fulfilled` and `cancelled` are both terminal. Attempting to release an order in either state
  is rejected with `409` (tested directly, including a simulated `fulfilled` order, since no
  fulfillment endpoint exists yet to reach that state naturally).

### Cancellation (release)

Release is a single conditional update:

```sql
UPDATE orders
SET status = 'cancelled', cancelled_at = now(), updated_at = now()
WHERE id = $1 AND organization_id = $2 AND status = 'pending'
```

This is the entire "exactly once" guarantee. PostgreSQL's row-level locking on `UPDATE` means
two concurrent release attempts for the same order are automatically serialized: whichever
transaction's `UPDATE` executes second sees `status` already `'cancelled'` and its `WHERE`
clause matches zero rows — no special locking code is needed beyond this one statement. Only
the request that actually flips the row decrements `inventory.reserved` (in the same
transaction, over the order's `order_items`, locked in the same ascending-`product_id` order as
reservation creation) and writes a `release` movement. Verified directly with two concurrent
release calls for the same reservation, asserting exactly one succeeds and `reserved` is
decremented exactly once (never negative, never double-credited).

`inventory_movements` rows are never deleted or edited by a release (or by anything else) —
only ever inserted. Historical movements are permanent.

## Tenant authorization

All four routes below sit behind `MembershipGuard` (Milestone 2: establishes the caller has an
active membership in `:organizationId`, independent of anything the client claims) and, for
mutating routes, `CsrfGuard` (Milestone 2: session-bound synchronizer token, ADR-004) — the
same mechanisms already protecting the organizations API, not a second authorization path.

Role enforcement (`RolesGuard` + `@Roles()`, Milestone 2) is split by trust level:

- **Reading inventory and creating/releasing reservations** are available to both `owner` and
  `staff` — routine day-to-day operational work.
- **Stock adjustments** (`POST .../inventory/adjustments`) are restricted to `owner` — an
  arbitrary on-hand change overrides the system-derived count (restock, shrinkage, correction)
  and is a materially higher-trust action than reserving existing stock.

## API

```
GET  /api/v1/organizations/:organizationId/inventory
POST /api/v1/organizations/:organizationId/inventory/adjustments
POST /api/v1/organizations/:organizationId/reservations
POST /api/v1/organizations/:organizationId/reservations/:id/release
```

Every `POST` requires an `Idempotency-Key` header (validated by
`idempotency/idempotency-key.decorator.ts`; missing or empty → `400`). Request bodies are
validated by the global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`) —
an unrecognized field is a `400`, not a silently-ignored value. Error responses never include
raw database error text or stack traces; the `HttpException` thrown for a rejected
`OperationOutcome` always carries a plain `{ message, ...details }` body.

### Example: adjust stock

```bash
curl -X POST http://localhost:3001/api/v1/organizations/$ORG_ID/inventory/adjustments \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  --cookie "fulfillos.sid=$SESSION_COOKIE" \
  -d '{"productId": "'"$PRODUCT_ID"'", "delta": 10, "reason": "restock"}'
```

### Example: create and release a reservation

```bash
curl -X POST http://localhost:3001/api/v1/organizations/$ORG_ID/reservations \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  --cookie "fulfillos.sid=$SESSION_COOKIE" \
  -d '{"items": [{"productId": "'"$PRODUCT_ID"'", "quantity": 2}]}'

curl -X POST http://localhost:3001/api/v1/organizations/$ORG_ID/reservations/$ORDER_ID/release \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  --cookie "fulfillos.sid=$SESSION_COOKIE"
```

## Tests

See [reservations.integration-spec.ts](../../apps/api/test/integration/reservations.integration-spec.ts),
[inventory.integration-spec.ts](../../apps/api/test/integration/inventory.integration-spec.ts),
[reservation-idempotency.integration-spec.ts](../../apps/api/test/integration/reservation-idempotency.integration-spec.ts),
[reservation-release.integration-spec.ts](../../apps/api/test/integration/reservation-release.integration-spec.ts)
(30 tests against real, concurrently-connected PostgreSQL) and
[inventory-reservations.security-spec.ts](../../apps/api/test/security/inventory-reservations.security-spec.ts)
(9 HTTP-level tests). All concurrency assertions check final database state directly (row
values), not only HTTP status codes or return values, and no test relies on an arbitrary sleep
for correctness — concurrent scenarios use `Promise.allSettled` over real, simultaneously-open
transactions, with bounded Jest timeouts.

## Known limitations

- **No fulfillment workflow.** `pending → fulfilled` (consuming a reservation permanently) is
  not implemented — deferred to a future milestone, per the existing schema comment's original
  intent.
- **No idempotency-key expiry job.** `expires_at` is a column with a default; nothing actively
  cleans up expired rows yet (inherited from Milestone 1 — see
  [database.md](database.md#known-limitations)).
- **No product-creation API.** This milestone assumes products already exist (via the seed
  script or a future catalog API); it only adds inventory/reservation behavior over them.
- **No multi-warehouse inventory.** One `inventory` row per product, matching ADR-002's stated
  MVP scope.
- **The default connection pool (10 connections) bounds real concurrency in tests and in
  production alike.** The 10-simultaneous-reservations test runs at exactly the pool's default
  size; a higher-throughput deployment would need an explicitly sized pool, which is not yet
  configured.
- **No automatic retry on deadlock/serialization failure.** See
  [Deadlock and serialization-failure handling](#deadlock-and-serialization-failure-handling) —
  the error codes are defined but no retry loop exists, since no tested scenario has required
  one.
