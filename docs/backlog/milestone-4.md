# Milestone 4 — Product Catalog, Order Management & Fulfillment (local backlog)

Local, offline backlog — GitHub authentication is unavailable in this environment. These are
**not** GitHub Issues; no issue numbers are implied or referenced in commit messages or code.

Status values used below: `not started`, `in progress`, `done`.

---

## M4-01: Product catalog creation

**Problem statement**
There is no way to create a product through the API yet — Milestone 3's inventory/reservation
engine assumed products already existed (seeded or inserted directly). A tenant needs to define
its own catalog, with initial stock established atomically, not as two separate steps a client
could interrupt between.

**Scope**
`ProductsService.createProduct` + `POST /api/v1/organizations/:organizationId/products`:
creates a `products` row and its initial `inventory` row in one transaction, reusing the
existing SKU normalization/uniqueness policy from Milestone 1.

**Acceptance criteria**

- SKU uniqueness is organization-scoped and case/whitespace-insensitive (existing
  `products_org_sku_normalized_key` constraint) — a duplicate is rejected with `409`, not a raw
  constraint error.
- The same SKU text is allowed across two different organizations.
- Product and its initial inventory row (`on_hand` = the request's initial quantity, `reserved`
  = 0) are created in one transaction — a product is never left without a corresponding
  inventory row.
- Invalid input (empty name, negative price, negative initial quantity) is rejected with `400`
  before reaching the database.
- Restricted to the `owner` role (see
  [docs/architecture/order-lifecycle.md](../architecture/order-lifecycle.md#security-and-tenant-isolation)
  for the reasoning) — defining catalog data and pricing is a higher-trust action than the
  day-to-day reservation/fulfillment flow.

**Dependencies**: Milestone 1 (`products`, `inventory`), Milestone 2 (auth/tenancy guards).

**Tests**: successful creation with atomic inventory initialization, duplicate SKU rejection,
same SKU across two organizations, invalid input rejection, cross-tenant/unauthorized creation
rejection.

**Completion status**: done (integration + HTTP security tests passing, including role/CSRF/cross-tenant/validation coverage in M4-06)

---

## M4-02: Product queries and pagination

**Problem statement**
A tenant needs to list and inspect its own catalog without exposing another tenant's products,
and a growing catalog needs pagination that doesn't shift under concurrent writes.

**Scope**
`GET /api/v1/organizations/:organizationId/products` (paginated list) and
`GET /api/v1/organizations/:organizationId/products/:productId` (detail, including current
inventory). Keyset (cursor) pagination, not offset-based — see
[order-lifecycle.md](../architecture/order-lifecycle.md) for why.

**Acceptance criteria**

- Listing is deterministically ordered and paginated by an opaque cursor, not a page number —
  concurrent inserts during pagination cannot cause an item to be skipped or repeated across
  pages in a way offset pagination would.
- Product detail includes current `on_hand`/`reserved`/`available` (zeros if no inventory row
  exists yet).
- A product belonging to a different organization returns `404`, not `403` (consistent with
  the existing "don't reveal existence" convention from Milestone 2's `MembershipGuard`).
- Available to both `owner` and `staff` — reading the catalog is routine.

**Dependencies**: M4-01.

**Tests**: pagination across multiple pages, cross-tenant access rejection, product detail
with and without initialized inventory.

**Completion status**: done (integration + HTTP security tests passing, including deterministic pagination verified over real HTTP in M4-06)

---

## M4-03: Order listing and retrieval

**Problem statement**
Milestone 3 could create and release reservations but had no way to list or inspect them as
"orders" — a tenant needs to see its order history and drill into a specific order's items.

**Scope**
`GET /api/v1/organizations/:organizationId/orders` (paginated list) and
`GET /api/v1/organizations/:organizationId/orders/:orderId` (detail, including line items,
quantities, and status). New `OrdersService`/`OrdersController` — read-side only in this item;
mutations are M4-04/M4-05.

**Acceptance criteria**

- Same keyset pagination convention as M4-02.
- Order detail includes every `order_items` row (product, quantity, unit price snapshot) and
  the order's current status.
- Cross-tenant order access returns `404`.
- Available to both `owner` and `staff`.

**Dependencies**: Milestone 3 (`orders`, `order_items`, `ReservationsService`).

**Tests**: listing, pagination, detail with correct items, cross-tenant isolation,
unauthorized access rejection.

**Completion status**: done (integration + HTTP security tests passing, including cross-tenant order access in M4-06)

---

## M4-04: Transactional fulfillment

**Problem statement**
A `pending` reservation needs a way to actually consume the stock it reserved — fulfillment —
which Milestone 3 explicitly deferred. This is the milestone's central new correctness
challenge: fulfillment must decrease both `on_hand` and `reserved` together, leaving `available`
unchanged, atomically, and exactly once.

**Scope**
`ReservationsService.fulfillOrder` (extends the existing service — see
[order-lifecycle.md](../architecture/order-lifecycle.md#fulfillment) for why it lives there
rather than in a new service) + `POST /api/v1/organizations/:organizationId/orders/:orderId/fulfill`.
A single conditional `UPDATE orders SET status = 'fulfilled' ... WHERE status = 'pending'`
(the same "exactly once" mechanism `releaseReservation` already uses) locks the order; inventory
rows are locked in the same ascending-`product_id` order as reservation/release.

**Acceptance criteria**

- Fulfilling a `pending` order with reserved stock decrements `on_hand` and `reserved` by
  exactly the order's item quantities; `available` (`on_hand - reserved`) is unchanged.
- Fulfillment cannot happen twice for the same order (conditional update; second attempt gets
  `409`).
- Fulfilling a `cancelled` order, or an order that doesn't exist in this organization, is
  rejected (`409`/`404`) without touching inventory.
- One `inventory_movements` row per line (`movement_type = 'fulfillment'`, new enum value —
  see the migration below) and one `audit_log` entry, in the same transaction.
- Guarded by the same idempotency mechanism as reservation/release (M3-03) —
  operation-scoped, canonical fingerprint, atomic with the business write.
- A failure partway through the transaction leaves no partial rows (order status, inventory,
  movements, and idempotency record all roll back together).

**Migration**: adds `'fulfillment'` to the `inventory_movement_type` enum and a nullable
`fulfilled_at` timestamp column to `orders` — both additive, reviewed and tested against the
isolated test database before being applied anywhere else.

**Dependencies**: Milestone 3 (`ReservationsService`, idempotency helper), M4-03.

**Tests**: single- and multi-product fulfillment, correct on-hand/reserved/available math,
correct movement and audit records, duplicate fulfillment rejection, rollback on injected
failure, concurrent fulfillment attempts, concurrent idempotent retries.

**Completion status**: done (integration + HTTP security tests passing, including the end-to-end workflow test in M4-06)

---

## M4-05: Cancellation and concurrency safety

**Problem statement**
Order-centric cancellation needs its own route, without re-implementing release logic, and
fulfillment and cancellation racing the same order must never both succeed.

**Scope**
`POST /api/v1/organizations/:organizationId/orders/:orderId/cancel` — a thin `OrdersController`
route that calls the existing `ReservationsService.releaseReservation` directly (the same
method `POST /reservations/:id/release` already uses). No new cancellation logic is
introduced; see [order-lifecycle.md](../architecture/order-lifecycle.md#fulfillment-vs-cancellation)
for why this is deliberate rather than an oversight.

**Acceptance criteria**

- `/orders/:orderId/cancel` and `/reservations/:id/release` produce identical results for the
  same order (same method, same idempotency operation scope).
- A `pending` order can be cancelled exactly once; a second attempt is rejected.
- Two concurrent requests — one fulfilling, one cancelling the same `pending` order — result in
  exactly one terminal transition; the loser sees a `409` naming the order's actual (other)
  terminal status, and inventory reflects only the winning transition.

**Dependencies**: Milestone 3 (`releaseReservation`), M4-04.

**Tests**: cancellation via the `/orders` route, repeated cancellation, concurrent
fulfill-vs-cancel race (real concurrent connections), final inventory/status assertions.

**Completion status**: done (integration + HTTP security tests passing, including the concurrent fulfill-vs-cancel race and the independent-cancellation end-to-end test in M4-06)

---

## M4-06: Integration, security, and E2E testing

**Problem statement**
The correctness and authorization claims above are only real if proven against a real,
concurrently-accessed PostgreSQL instance and real HTTP requests.

**Scope**
Integration tests for catalog and order read/write paths (real Postgres, real concurrent
connections for the fulfillment/cancellation races), HTTP security tests for every new route
(missing session, expired session, missing/invalid CSRF, wrong role, cross-tenant product and
order IDs), and a full end-to-end workflow test exercised over real HTTP.

**Acceptance criteria**

- All catalog, order, fulfillment, and cancellation scenarios listed in the milestone brief are
  covered and pass against real Postgres — no database mocking for the behavior under test.
- Concurrency assertions check final database state (row values), not only HTTP status codes;
  no test relies on an arbitrary sleep; Jest timeouts are bounded.
- The full pre-existing suite (unit, Milestone 1 integration, Milestone 2 security, Milestone 3
  inventory/reservation tests) still passes unmodified.
- The existing Playwright authentication test still passes, reported separately from the API
  test suites (it exercises the browser/frontend, not this milestone's API surface).

**Dependencies**: M4-01 through M4-05.

**Tests**: this item _is_ the test suite (see
[order-lifecycle.md](../architecture/order-lifecycle.md) for the full list actually executed
and their results).

**Completion status**: done (91 integration tests, 52 security tests — including a dedicated 2-test end-to-end workflow spec — all pass against real Postgres; full pre-existing suite unmodified; existing Playwright auth test re-run and passing, reported separately below)

---

## M4-07: Documentation and final verification

**Problem statement**
The state machine, lock ordering, and idempotency guarantees above are only trustworthy to a
future reader if written down accurately, and only real if the full quality-gate suite has
actually been run.

**Scope**
`docs/architecture/order-lifecycle.md` (product creation, order state machine, reservation,
fulfillment, cancellation, transaction boundaries, lock ordering, idempotency, security/tenant
isolation, failure recovery, known limitations), updates to
`docs/architecture/inventory.md` and ADR-002 where implementation decisions evolved, and README
updates (status, setup, testing, API examples).

**Acceptance criteria**

- Documentation describes only what is actually implemented and tested — no payment, shipping,
  multi-warehouse, or partial-fulfillment support is claimed.
- Final quality gates (format, lint, typecheck, unit, integration, security, e2e, Playwright,
  both production builds) are run for real and their actual results reported.

**Dependencies**: M4-01 through M4-06.

**Tests**: none beyond re-running the full suite as a final gate.

**Completion status**: not started
