# Milestone 3 — Transactional Inventory Engine (local backlog)

Local, offline backlog — GitHub authentication is unavailable in this environment. These are
**not** GitHub Issues; no issue numbers are implied or referenced in commit messages or code.

Status values used below: `not started`, `in progress`, `done`.

---

## M3-01: Inventory domain and stock adjustments

**Problem statement**
Before reservations can be built, the inventory domain needs an application layer over the
Milestone 1 `inventory`/`inventory_movements` schema: reading current stock and safely applying
stock-count adjustments, without ever letting a client-supplied "available" value be trusted.

**Scope**
`InventoryService`/`InventoryModule`: read inventory for an organization; apply a signed
on-hand adjustment (count correction, restock, shrinkage) inside a transaction, writing an
`inventory_movements` row (`on_hand_adjustment`) in the same transaction. No reservation logic
here — that is M3-02.

**Acceptance criteria**

- `available` is always computed as `on_hand - reserved` server-side; it is never accepted as
  client input and never stored as its own column.
- An adjustment cannot drive `on_hand` negative, and cannot reduce `on_hand` below the current
  `reserved` (both already enforced by the Milestone 1 `CHECK` constraints as a backstop; the
  service rejects these with a clear 4xx before the database would).
- Adjustment deltas are bounded to prevent 32-bit integer overflow of `on_hand`.
- Every adjustment writes exactly one `inventory_movements` row, in the same transaction as the
  `inventory` row update.

**Dependencies**: Milestone 1 (`inventory`, `inventory_movements`), Milestone 2 (auth/tenancy
guards).

**Tests**: initialization/read, valid increase, valid decrease, rejected decrease below zero,
rejected decrease below `reserved`, overflow rejection, movement row written atomically with
the stock change.

**Completion status**: done (11 integration tests passing against real Postgres; also
introduces the shared idempotency helper used by M3-03, exercised here for the adjustments
path)

---

## M3-02: Atomic multi-product reservations

**Problem statement**
This is the project's central technical challenge: concurrent customers reserving the same
scarce stock must never oversell, and a multi-product order must reserve all lines or none.

**Scope**
Reservation-creation logic per [ADR-002](../adr/0002-postgres-inventory-consistency.md): row
locks (`SELECT ... FOR UPDATE`) on the affected `inventory` rows in deterministic (ascending
`product_id`) order, all-or-nothing stock validation across every line, and persistence of the
order/order-item/movement/audit records in one transaction. Reuses the existing `orders` /
`order_items` tables from Milestone 1 as the reservation record — no new `reservations` table
(see [docs/architecture/inventory.md](../architecture/inventory.md#reservation-lifecycle) for
why the existing `order_status` model was adopted as-is instead of the `CREATED`/`RESERVED`/
`CANCELLED` states outlined in the milestone brief).

**Acceptance criteria**

- A reservation authenticates the caller, re-verifies active organization membership, and
  confirms every requested product belongs to that same organization before touching inventory.
- Duplicate product lines in one request are rejected (not silently merged).
- All requested lines are validated against currently-locked, authoritative stock before any
  row is written; if any line is short, the entire request is rejected and nothing is written.
- Two concurrent reservations for the last unit of the same product: exactly one succeeds.
- A multi-product reservation where only one line is short: no partial reservation of the
  other, sufficient lines.

**Dependencies**: M3-01, Milestone 1 (`orders`, `order_items`), Milestone 2 (auth/tenancy).

**Tests**: successful multi-product reservation, insufficient stock (single- and multi-product),
concurrent reservation of the last unit (real concurrent connections), concurrent requests
listing the same products in opposite order (deadlock-freedom check), final on-hand/reserved
state asserted directly against the database.

**Completion status**: done (9 integration tests passing against real, concurrent Postgres
connections, including the 2-of-1 and 3-of-10 last-unit races, opposite-order deadlock-freedom,
a concurrent stock-adjustment-vs-reservation race, and a mid-transaction rollback proof)

---

## M3-03: Transactional request idempotency

**Problem statement**
A client retry (network timeout, double-click, load balancer retry) must not create a second
reservation or apply a stock adjustment twice, and a genuinely new request must not be
rejected just because it reuses an expired or unrelated key.

**Scope**
A shared idempotency helper over the existing Milestone 1 `idempotency_keys` table, used by
both the adjustment and reservation/release write paths. Tenant- and operation-scoped keys,
canonical request fingerprinting, and database-enforced uniqueness — no check-then-insert race.

**Acceptance criteria**

- The idempotency row and the business write (or business rejection) commit in the same
  transaction; there is no window where one is durable and the other is not.
- Same key + same payload, repeated: returns the original result without a second side effect.
- Same key + different payload: rejected with a conflict, no side effect.
- Concurrent requests with the same key: exactly one proceeds; the other(s) either replay the
  first's result or receive a "still in progress" conflict — never a second reservation.
- An attempt that fails for an ambiguous reason (e.g. a dropped connection) leaves no
  claimed-but-incomplete row behind that would permanently block a legitimate retry.

**Dependencies**: Milestone 1 (`idempotency_keys`), M3-01, M3-02.

**Tests**: identical retry replay, conflicting-payload rejection, concurrent identical
requests, concurrent conflicting requests.

**Completion status**: done (4 integration tests passing against real Postgres, plus 2 more
covering the same mechanism for inventory adjustments in M3-01's test file)

---

## M3-04: Reservation release and cancellation

**Problem statement**
A reservation must be releasable exactly once — repeated or concurrent release attempts on the
same reservation must not free more stock than was originally reserved.

**Scope**
Release/cancellation logic transitioning an order from `pending` to `cancelled` (see M3-02's
note on reusing the existing `order_status` enum), decrementing `inventory.reserved` back down,
writing a `release` movement and an audit record, all in one transaction, guarded by a
conditional update so a second concurrent release is a no-op rather than a double-credit.

**Acceptance criteria**

- Releasing a `pending` reservation decrements `reserved` by exactly the reserved quantities and
  marks the order `cancelled`.
- Releasing an already-`cancelled` (or otherwise non-`pending`) order is rejected without
  changing inventory a second time.
- Two concurrent release requests for the same reservation: exactly one has effect.
- Historical `inventory_movements` rows are never deleted or edited by a release.

**Dependencies**: M3-02, M3-03.

**Tests**: successful release, double release (sequential), concurrent release (real
concurrent connections), release of a non-existent/foreign-tenant reservation.

**Completion status**: done (6 integration tests passing against real Postgres, including the
concurrent-release race and a release attempt against an already-fulfilled order)

---

## M3-05: Tenant-scoped inventory API

**Problem statement**
The engine above needs an authenticated, tenant-scoped, role-enforced HTTP surface, reusing
Milestone 2's session/CSRF/membership machinery rather than a parallel mechanism.

**Scope**

```
GET  /api/v1/organizations/:organizationId/inventory
POST /api/v1/organizations/:organizationId/inventory/adjustments
POST /api/v1/organizations/:organizationId/reservations
POST /api/v1/organizations/:organizationId/reservations/:id/release
```

**Acceptance criteria**

- Every route requires a valid session, active membership in `:organizationId`, and (for
  mutating routes) a valid CSRF token — the same guards Milestone 2 already established, not a
  second authentication path.
- Stock adjustments require the `owner` role; reservation creation and release are available to
  both `owner` and `staff` (see
  [docs/architecture/inventory.md](../architecture/inventory.md#tenant-authorization) for the
  reasoning).
- Request bodies are validated (whitelist, reject unknown fields); invalid input never reaches
  the database layer.
- Errors are consistent, tenant-safe HTTP responses — no raw database error text or stack
  traces in any response body.

**Dependencies**: M3-01 through M3-04, Milestone 2 (`SessionAuthGuard`, `CsrfGuard`,
`MembershipGuard`, `RolesGuard`).

**Tests**: covered jointly with M3-06 (HTTP-level tenancy/role/CSRF tests against the new
routes).

**Completion status**: not started

---

## M3-06: Concurrency, rollback, and security testing

**Problem statement**
The correctness claims above are only real if proven against a real, concurrently-accessed
PostgreSQL instance and real HTTP requests — not asserted from sequential, single-connection
tests.

**Scope**
Integration tests using multiple real database connections/pools firing genuinely concurrent
requests (`Promise.all`, not sequential `await`s), plus HTTP-level security tests for the new
endpoints reusing the Milestone 2 security-test harness.

**Acceptance criteria**

- Tests cover: 10 simultaneous reservations against limited stock; concurrent requests listing
  the same products in opposite order; a multi-product reservation with one insufficient line;
  transaction rollback after an injected mid-transaction failure leaves no partial rows;
  concurrent stock adjustment racing a reservation; concurrent release of the same reservation.
- Assertions check final database state directly (row values), not only HTTP status codes.
- No test relies on an arbitrary `sleep` for correctness; timeouts are bounded.
- Cross-tenant access, wrong-role access, and missing/invalid CSRF tokens against the new
  endpoints are all rejected.
- The full pre-existing test suite (unit, Milestone 1 integration, Milestone 2 security) still
  passes unmodified.

**Dependencies**: M3-01 through M3-05.

**Tests**: this item _is_ the test suite (see
[docs/architecture/inventory.md](../architecture/inventory.md) for the full list actually
executed and their results).

**Completion status**: not started

---

## M3-07: Documentation and final verification

**Problem statement**
The concurrency and idempotency guarantees above are only trustworthy to a future reader if the
data model, transaction boundaries, and known limitations are written down accurately.

**Scope**
`docs/architecture/inventory.md` (data model, invariants, transaction boundaries, lock order,
isolation-level decision, deadlock handling, idempotency lifecycle, reservation lifecycle,
tenant authorization, known limitations), an ADR-002 addendum for any decisions that evolved
during implementation, and README updates (setup/testing instructions, API examples).

**Acceptance criteria**

- Documentation describes only what is actually implemented and tested — no aspirational or
  planned-but-unbuilt behavior presented as done.
- ADR-002 is extended with a dated addendum, not silently rewritten.
- Final quality gates (format, lint, typecheck, unit, integration, security, new inventory
  tests, build) are run for real and their actual results reported.

**Dependencies**: M3-01 through M3-06.

**Tests**: none beyond re-running the full suite as a final gate.

**Completion status**: not started
