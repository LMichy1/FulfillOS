# Product Catalog, Order Management & Fulfillment

## Status

Implemented and tested as of Milestone 4: tenant-scoped product creation, product and order
queries with deterministic pagination, transactional order fulfillment, and order-centric
cancellation. This document describes what is actually built and verified — see
[Known limitations](#known-limitations) for what is explicitly deferred. Extends
[docs/architecture/inventory.md](inventory.md), which this document assumes as background
(invariants, transaction boundaries, lock order, the idempotency mechanism, and why
reservations reuse the existing `orders`/`order_items` tables) — it is not repeated here
except where Milestone 4 adds to or refines it.

## Product creation

`ProductsService.createProduct` creates a `products` row and its initial `inventory` row in
one transaction (`db.transaction(async (tx) => ...)`) — a product is never left without a
corresponding inventory row, even momentarily, and initial stock is never a separate step a
client request could be interrupted between. If an initial quantity greater than zero is
given, exactly one `inventory_movements` row (`movement_type = 'on_hand_adjustment'`) is
written in the same transaction, so the very first stock a product ever has is just as
explainable after the fact as any later adjustment.

SKU handling reuses the Milestone 1 policy unchanged: `products_org_sku_normalized_key`
(a unique index on `organization_id` + `lower(btrim(sku))`) is what actually enforces
uniqueness, case- and whitespace-insensitively, scoped per organization — the same SKU text is
allowed in two different organizations. A duplicate is caught by its Postgres error code
(`23505`) and translated to a clean `409`, never a raw constraint-violation message.

There is deliberately no idempotency-key mechanism on product creation, unlike fulfillment and
cancellation (see [Idempotency](#idempotency) below): a retried create request is already safe
without one, because the SKU uniqueness constraint itself rejects an accidental duplicate with
the same clean `409` every time. There is no "partial outcome" an idempotency key would need to
protect replaying differently.

## Order state machine

The milestone brief suggested introducing `CREATED` / `RESERVED` / `CANCELLED` states.
Milestone 1's schema already defines `orders.status` as an enum — `pending`, `fulfilled`,
`cancelled` — and Milestone 3 already built the `pending` creation and `pending -> cancelled`
release transitions on top of it. This milestone adopts that existing model as-is rather than
introducing a parallel one:

```
                    pending
                   /       \
                  v         v
             fulfilled   cancelled
```

- `pending`: the order exists, its items are recorded, and the corresponding stock is held in
  `inventory.reserved` (Milestone 3).
- `pending -> fulfilled`: consumes the reservation permanently. This milestone's new work — see
  [Fulfillment](#fulfillment).
- `pending -> cancelled`: releases the reservation (Milestone 3, reused unchanged — see
  [Fulfillment vs. cancellation](#fulfillment-vs-cancellation)).
- `fulfilled` and `cancelled` are both terminal. No transition is permitted out of either.

**Enforcement mechanism**: there is deliberately no database `CHECK` constraint encoding legal
transitions (a stateless per-row check can't express "the _previous_ value of this column
matters"). Instead, every transition is a single conditional `UPDATE ... WHERE status =
'pending'` — the same primitive `releaseReservation` introduced in Milestone 3, and the one
`fulfillOrder` reuses exactly. This is what makes a transition atomic _and_ safe under
concurrency: Postgres's own row-level locking on `UPDATE` serializes two competing attempts
against the same row, so whichever executes second sees `status` already moved away from
`'pending'` and its `WHERE` clause matches zero rows — no separate locking code is needed
beyond this one statement. See [Fulfillment vs. cancellation](#fulfillment-vs-cancellation) for
why this is also what guarantees the two competing _business_ transitions can never both win.

## Fulfillment

`ReservationsService.fulfillOrder` (extending, not duplicating, the service Milestone 3 already
built — see [Why fulfillment lives in ReservationsService](#why-fulfillment-lives-in-reservationsservice))
implements the `pending -> fulfilled` transition:

```
new_on_hand  = old_on_hand  - quantity
new_reserved = old_reserved - quantity
available    = on_hand - reserved   (unchanged: both counters move by the same amount)
```

Sequence, all inside one transaction:

1. Authenticate and authorize — `SessionAuthGuard` (global) and `MembershipGuard`
   (organization-scoped) run before the controller method is even called; `CsrfGuard` on the
   mutating route.
2. Claim the idempotency key (first statement in the transaction — see
   [Idempotency](#idempotency)).
3. Conditionally transition the order: `UPDATE orders SET status = 'fulfilled', fulfilled_at =
now() WHERE id = $1 AND organization_id = $2 AND status = 'pending' RETURNING *`. Zero rows
   affected means either the order doesn't exist in this organization (`404`) or it is already
   in a terminal state (`409` naming which one) — checked with a follow-up `SELECT`, not
   assumed.
4. Load the order's authoritative `order_items` (locked implicitly by having just locked the
   parent `orders` row via step 3's `UPDATE`).
5. Lock the affected `inventory` rows with `SELECT ... FOR UPDATE OF inventory` in **ascending
   `product_id` order** — the identical lock order `createReservation` and `releaseReservation`
   already use (see [inventory.md#transaction-boundaries-and-lock-order](inventory.md#transaction-boundaries-and-lock-order)).
   A shared, consistent lock order across all three operations (reserve, release, fulfill) is
   what rules out a deadlock between any pair of them, not just between two reservations.
6. Verify each line's locked `on_hand`/`reserved` are still at least the quantity being
   fulfilled — an invariant, not a normal business rejection (see the code comment in
   `reservations.service.ts`: this can only fail if a prior bug let the reserved/on_hand
   relationship drift, since a stock adjustment can reduce `on_hand` but never `reserved`, and
   the CHECK constraint `reserved <= on_hand` is already enforced at every write). It fails
   loudly (throws, rolling back the transaction) rather than silently under-fulfilling.
7. Decrement `on_hand` and `reserved` together for each line.
8. Write one `inventory_movements` row per line (`movement_type = 'fulfillment'` — a new enum
   value added this milestone, distinct from `'release'`: it carries a negative `on_hand_delta`
   as well as a negative `reserved_delta`).
9. Write one `audit_log` entry (`action = 'order.fulfill'`).
10. Persist the idempotency outcome (last statement — see [Idempotency](#idempotency)).
11. Commit.

If any step throws, the whole transaction rolls back — proven directly by a test that injects
a failure after the order-status and inventory updates have already run inside the same
transaction, then asserts both are back to their pre-transaction values.

### Why fulfillment lives in ReservationsService

Rather than a new service reimplementing lock order and idempotency wiring, `fulfillOrder` was
added directly to `ReservationsService`, alongside `createReservation` and
`releaseReservation`. All three: open one transaction, claim an idempotency key first, lock
`inventory` rows in the same ascending-`product_id` order, and commit the idempotency outcome
last. `OrdersService` (this milestone's new read-side service) calls
`ReservationsService.fulfillOrder`/`releaseReservation` directly rather than reimplementing
either — see [Fulfillment vs. cancellation](#fulfillment-vs-cancellation).

## Fulfillment vs. cancellation

The three inventory-affecting operations have distinct, easily-confused effects:

| Operation    | `on_hand` | `reserved` | `available` |
| ------------ | --------- | ---------- | ----------- |
| Reservation  | unchanged | increases  | decreases   |
| Cancellation | unchanged | decreases  | increases   |
| Fulfillment  | decreases | decreases  | unchanged   |

**A concurrent fulfillment and cancellation of the same order can never both succeed.** Both
`fulfillOrder` and `releaseReservation` compete for the identical conditional `UPDATE orders
... WHERE status = 'pending'` on the same order row — the single consistent state-transition
mechanism referenced in [Order state machine](#order-state-machine). Postgres's row-level
locking on that `UPDATE` serializes the two attempts: whichever executes first wins and moves
`status` to its target terminal value; the second sees `status` is no longer `'pending'` and
its own conditional `UPDATE` affects zero rows, so it takes the "already terminal" rejection
path without ever reaching its own inventory-locking step. This is verified directly with two
truly concurrent transactions (`Promise.allSettled`, not sequential awaits) racing
`fulfillOrder` against `releaseReservation` for the same `pending` order, asserting exactly one
of the two settles as fulfilled and the final inventory row reflects only the winning
transition's math — never a mix of both, never neither.

**`POST /orders/:orderId/cancel` is not a second cancellation implementation.** It is a thin
`OrdersController` route that calls `ReservationsService.releaseReservation` directly — the
exact method `POST /reservations/:id/release` already used in Milestone 3. Both URLs produce
identical results for the same order, including sharing the same idempotency operation scope
(`reservation.release`); a key claimed via one path is visible to the other. This is
deliberate, not an oversight: the milestone brief explicitly asked to reuse the existing
release logic rather than duplicate it, and two URLs converging on one implementation is the
most direct way to guarantee they can never drift apart in behavior.

## Idempotency

Fulfillment and cancellation are both guarded by the exact same mechanism documented in
[inventory.md#idempotency](inventory.md#idempotency) (claim → business logic → complete, all
one transaction; a clean rejection is a completed, replayable outcome; a genuinely unexpected
error rolls back the claim along with everything else). Two points specific to this milestone:

- **A different idempotency key never bypasses the terminal-state protection.** Once an order
  is `fulfilled` or `cancelled`, a fulfillment/cancellation attempt with a _brand-new_ key still
  reaches the conditional `UPDATE ... WHERE status = 'pending'` and still gets zero rows
  affected — idempotency keys guard against _duplicate_ requests, not against re-attempting an
  operation that is legitimately no longer valid. Verified directly: fulfilling an order,
  then attempting to fulfill it again with a never-before-seen key, is rejected with `409`.
- **A lost response after a successful commit is safe to retry identically.** If a client's
  connection drops after `fulfillOrder` has committed but before the HTTP response reaches it,
  retrying with the same idempotency key and the same (empty) body replays the original
  `200 fulfilled` response without consuming inventory a second time — proven directly, and
  exercised end-to-end in the [full workflow test](#tests).

## Pagination

`GET /products` and `GET /orders` use keyset (cursor) pagination — see
[common/pagination.util.ts](../../apps/api/src/common/pagination.util.ts) — ordered `(created_at
DESC, id DESC)`. A page is "rows strictly after this cursor position", not "skip N rows": a row
created concurrently with a paginated listing can never cause an already-returned row to be
skipped or an unreturned row to be repeated across pages, the way `OFFSET`-based pagination can.
The cursor is an opaque base64url-encoded `{createdAt, id}` pair; a present-but-undecodable
cursor is rejected with `400`, not silently treated as "start from the beginning".

## Security and tenant isolation

Every new route sits behind the same guards Milestone 2 established — `SessionAuthGuard`
(global, deny-by-default), `MembershipGuard` (confirms active membership in
`:organizationId`, never trusting the client-supplied id by itself), and `CsrfGuard` on
mutating routes (session-bound synchronizer token, ADR-004). No parallel authentication or
authorization mechanism was introduced.

Role enforcement (`RolesGuard` + `@Roles()`) is split by trust level, consistent with the
precedent Milestone 3 set for inventory adjustments:

- **Product creation** (`POST /products`): `owner` only. Defining catalog data and pricing is a
  higher-trust action than the day-to-day reservation/fulfillment flow — the same reasoning
  already applied to inventory adjustments.
- **Everything else new** (product/order reads, order fulfillment, order cancellation):
  `owner` or `staff`. Reading the catalog, fulfilling an order, and cancelling an order are all
  routine operational work.

A product or order belonging to a different organization returns `404` from every route that
looks one up by id — reads, fulfillment, and cancellation — consistent with the existing
"don't reveal existence to a non-member" convention from `MembershipGuard`. Verified directly,
including confirming a cross-tenant fulfillment/cancellation _attempt_ never actually changes
the real owner's order.

## Failure recovery

- **Mid-transaction failure**: rolls back everything in that transaction — order status,
  inventory, movements, audit record, and the idempotency claim all revert together. Proven
  directly with an injected failure after partial writes.
- **Lost response after commit**: safe to retry with the same idempotency key (see
  [Idempotency](#idempotency)) — the retry replays the original result rather than re-running
  business logic.
- **A concurrent competing transition** (fulfill vs. cancel) resolves to exactly one winner via
  ordinary row-level locking, with no special-case recovery code required — the loser's
  rejection _is_ the correct, final outcome, not a transient state to retry past.

## Tests

See
[products.integration-spec.ts](../../apps/api/test/integration/products.integration-spec.ts),
[orders.integration-spec.ts](../../apps/api/test/integration/orders.integration-spec.ts),
[order-fulfillment.integration-spec.ts](../../apps/api/test/integration/order-fulfillment.integration-spec.ts),
and
[order-cancellation-race.integration-spec.ts](../../apps/api/test/integration/order-cancellation-race.integration-spec.ts)
(27 tests against real, concurrently-connected PostgreSQL), plus
[catalog-orders.security-spec.ts](../../apps/api/test/security/catalog-orders.security-spec.ts)
(9 HTTP-level tests) and
[end-to-end-workflow.security-spec.ts](../../apps/api/test/security/end-to-end-workflow.security-spec.ts)
(2 tests exercising the complete register → create product → reserve → fulfill → verify →
retry workflow, and an independent cancellation workflow, entirely over real HTTP with no
manual database setup). All concurrency assertions check final database state directly, not
only HTTP status codes or return values; no test relies on an arbitrary sleep; Jest timeouts are
bounded. The existing Playwright authentication suite (3 tests) was re-run against live dev
servers and passes unchanged — it exercises the browser/frontend, not this milestone's API
surface, so it is reported separately from the API test suites above.

## Known limitations

- **No order fulfillment beyond the single `pending -> fulfilled` transition.** There is no
  partial fulfillment, no shipping or delivery tracking, and no payment processing — none of
  this was in scope for this milestone.
- **No catalog management beyond creation.** No product update, archive/reactivate transition
  (the `product_status` enum exists in the schema from Milestone 1 but no endpoint changes it),
  or deletion endpoint exists yet.
- **No multi-warehouse fulfillment.** Consistent with the inventory engine's existing MVP scope
  (one `inventory` row per product) — fulfillment has no location dimension to choose from.
- **Product/order pagination has no supporting index beyond the primary key and existing
  tenant-scoping indexes.** At the data volumes this project is built and tested for, a
  sequential scan with a sort is not a practical concern; a dedicated `(organization_id,
created_at)` index would be the natural addition if that changed.
- **No idempotency-key expiry job** (inherited from Milestone 1/3 — see
  [inventory.md#known-limitations](inventory.md#known-limitations)).
