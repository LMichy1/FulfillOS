# Database

## Status

Schema and seed script implemented as of Milestone 1; migrations remain additive-only as later
milestones extend the schema (most recently Milestone 4's `orders.fulfilled_at` column and
`inventory_movement_type`'s `'fulfillment'` enum value). Application code now reads and writes
these tables: authentication and organization membership (Milestone 2, see
[authentication.md](authentication.md)), the inventory/reservation engine (Milestone 3), and
product catalog + order fulfillment/cancellation (Milestone 4) — see
[inventory.md](inventory.md) and [order-lifecycle.md](order-lifecycle.md).

## Domain overview

Ten tables, three domain groups:

- **Identity and organizations**: `organizations`, `users`, `memberships`
- **Catalog and inventory**: `products`, `inventory`, `inventory_movements`
- **Orders and cross-cutting concerns**: `orders`, `order_items`, `idempotency_keys`,
  `audit_log`

## Entity-relationship diagram

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ MEMBERSHIPS : has
    USERS ||--o{ MEMBERSHIPS : has
    ORGANIZATIONS ||--o{ PRODUCTS : owns
    ORGANIZATIONS ||--o{ INVENTORY : owns
    ORGANIZATIONS ||--o{ INVENTORY_MOVEMENTS : owns
    ORGANIZATIONS ||--o{ ORDERS : owns
    ORGANIZATIONS ||--o{ ORDER_ITEMS : owns
    ORGANIZATIONS ||--o{ IDEMPOTENCY_KEYS : owns
    ORGANIZATIONS ||--o{ AUDIT_LOG : owns
    PRODUCTS ||--|| INVENTORY : "has one"
    PRODUCTS ||--o{ INVENTORY_MOVEMENTS : "moves"
    PRODUCTS ||--o{ ORDER_ITEMS : "ordered as"
    ORDERS ||--o{ ORDER_ITEMS : contains
    USERS ||--o{ AUDIT_LOG : "acts in (optional)"

    ORGANIZATIONS {
        uuid id PK
        text name
    }
    USERS {
        uuid id PK
        text email
        text email_normalized "generated, unique"
        text password_hash
    }
    MEMBERSHIPS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        enum role "owner | staff"
    }
    PRODUCTS {
        uuid id PK
        uuid organization_id FK
        text sku
        text sku_normalized "generated, unique per org"
        integer unit_price_cents
        enum status "active | archived"
    }
    INVENTORY {
        uuid id PK
        uuid organization_id FK
        uuid product_id FK "unique; composite FK to products"
        integer on_hand
        integer reserved
    }
    INVENTORY_MOVEMENTS {
        uuid id PK
        uuid organization_id FK
        uuid product_id FK "composite FK to products"
        enum movement_type
        integer on_hand_delta
        integer reserved_delta
    }
    ORDERS {
        uuid id PK
        uuid organization_id FK
        enum status "pending | fulfilled | cancelled"
        char currency "ISO 4217"
    }
    ORDER_ITEMS {
        uuid id PK
        uuid organization_id FK "denormalized, see below"
        uuid order_id FK "composite FK to orders"
        uuid product_id FK "composite FK to products"
        integer quantity
        integer unit_price_cents "price snapshot"
    }
    IDEMPOTENCY_KEYS {
        uuid id PK
        uuid organization_id FK
        text operation
        text idempotency_key
        text request_fingerprint
        enum state "in_progress | completed | failed"
    }
    AUDIT_LOG {
        uuid id PK
        uuid organization_id FK
        uuid actor_user_id FK "nullable"
        text action
        text resource_type
        text resource_id "not a real FK, see below"
    }
```

## Tenant isolation strategy

Every tenant-owned table carries `organization_id`, but a column alone doesn't stop a bug
from inserting `inventory` row for org A pointing at a product actually owned by org B — that
requires the database to check the _pair_, not just that each id independently exists. This
schema does that with **composite foreign keys**:

- `products` has `UNIQUE(id, organization_id)` (in addition to its primary key on `id` alone)
  specifically so other tables can reference _both_ columns together.
- `orders` has the same `UNIQUE(id, organization_id)` for the same reason.
- `inventory.(product_id, organization_id)` → `products.(id, organization_id)`. An inventory
  row's `organization_id` must match the `organization_id` already on the product it points
  to, or the insert is rejected — a database error, not an application bug caught later.
- `order_items` denormalizes `organization_id` from its parent order specifically so it can
  hold two composite foreign keys at once: `(order_id, organization_id)` → `orders.(id,
organization_id)` and `(product_id, organization_id)` → `products.(id, organization_id)`.
  This is what makes "an order item can only reference a product from its own order's
  organization" a database-enforced invariant instead of something application code has to
  remember to check.

**This is relational integrity, not authorization.** These constraints stop a row from
_existing_ in an inconsistent cross-tenant state; they say nothing about who is allowed to
read or write it over HTTP. A user from organization A who is (incorrectly) allowed to query
"give me inventory row X" can still read organization B's row if X happens to belong to B —
the composite FKs don't prevent that, because that's not a data-integrity question, it's an
authorization question. Enforcing _that_ — resolving the acting user's organization from
their authenticated session and checking it against every resource read/written — is
Milestone 2's job (see [ADR-003](../adr/0003-multi-tenant-authorization.md)). The integration
tests in `apps/api/test/integration/` cover the relational-integrity guarantees above; they do
not and cannot test authorization, since no auth code exists yet.

**Indexes for tenant-scoped queries**: `organization_id` (or a composite starting with it) is
the leftmost indexed column everywhere a "list X for this organization" query is expected —
`inventory_organization_id_idx`, `orders_organization_id_created_at_idx`,
`audit_log_organization_id_created_at_idx`, and the unique indexes on `memberships` and
`products` which double as org-scoped lookup indexes. `memberships_user_id_idx` exists
separately for the reverse direction ("which organizations does this user belong to"), since
`user_id` isn't the leftmost column of the membership uniqueness constraint.

Row-Level Security was considered and deliberately not enabled in this milestone: RLS
requires a tested strategy for how the application's database connection communicates "which
organization is this request for" to Postgres (e.g. `SET app.current_org_id`) on every
connection checkout, and getting that wrong silently reintroduces the exact cross-tenant bug
class it's meant to prevent. Application-layer authorization plus the composite-FK relational
integrity above is this milestone's actual guarantee; RLS remains a documented option to
revisit once Milestone 2's session/connection handling exists to base it on.

## Important foreign keys

Summarized (see `apps/api/src/database/schema/*.ts` and `apps/api/drizzle/0000_init_schema.sql`
for the exact, generated DDL):

| Table                 | Foreign key                                                        | On delete    |
| --------------------- | ------------------------------------------------------------------ | ------------ |
| `memberships`         | `organization_id` → `organizations.id`                             | cascade      |
| `memberships`         | `user_id` → `users.id`                                             | cascade      |
| `products`            | `organization_id` → `organizations.id`                             | cascade      |
| `inventory`           | `organization_id` → `organizations.id`                             | cascade      |
| `inventory`           | `(product_id, organization_id)` → `products.(id, organization_id)` | cascade      |
| `inventory_movements` | `(product_id, organization_id)` → `products.(id, organization_id)` | cascade      |
| `orders`              | `organization_id` → `organizations.id`                             | **restrict** |
| `order_items`         | `(order_id, organization_id)` → `orders.(id, organization_id)`     | cascade      |
| `order_items`         | `(product_id, organization_id)` → `products.(id, organization_id)` | **restrict** |
| `idempotency_keys`    | `organization_id` → `organizations.id`                             | cascade      |
| `audit_log`           | `organization_id` → `organizations.id`                             | cascade      |
| `audit_log`           | `actor_user_id` → `users.id`                                       | **set null** |

`orders` and `order_items → products` use `RESTRICT` rather than `CASCADE` deliberately:
orders are business/financial records, not disposable configuration. Deleting an organization
or a product that has ever been ordered should fail loudly rather than silently erase order
history. (Organization deletion isn't an implemented feature at all yet — this is a
forward-looking safeguard.)

## Important unique constraints

- `organizations`: none beyond the primary key — organization identity is just its id.
- `users`: `email_normalized` (generated as `lower(btrim(email))`) is unique — "User@Ex.com"
  and " user@ex.com " collide regardless of application behavior.
- `memberships`: `(organization_id, user_id)` — a user cannot join the same organization
  twice.
- `products`: `(organization_id, sku_normalized)` (generated as `lower(btrim(sku))`) — SKUs
  are case/whitespace-insensitive and scoped per organization; the same SKU text is fine in
  two different organizations.
- `inventory`: `product_id` — exactly one inventory row per product (see Inventory invariants
  below).
- `idempotency_keys`: `(organization_id, operation, idempotency_key)`.

## Inventory invariants

```
available = on_hand - reserved
on_hand   >= 0
reserved  >= 0
reserved  <= on_hand     (equivalent to available >= 0)
```

All three enforced as PostgreSQL `CHECK` constraints on `inventory`, not just in application
code — see [ADR-002](../adr/0002-postgres-inventory-consistency.md) for the full concurrency
strategy (row-level locking, deterministic lock ordering) these constraints back up.
`available` is intentionally not a stored column — it's a derived value computed at read time
from the two authoritative counters, so it can never itself drift out of sync.

`inventory_movements` is an append-only ledger for traceability (which change happened, why,
and what caused it). As of Milestone 3, stock adjustments, reservations, and releases each
insert one row here in the same transaction that updates `inventory.on_hand`/`reserved` — see
[inventory.md](inventory.md) for the application layer.

## Idempotency design

`idempotency_keys` exists so Milestone 3 can make write operations (like "create this order")
safe to retry. The schema is designed around one specific failure mode: a naive "check if a
row with this key exists, then insert if not" is a race condition — two concurrent requests
with the same key can both pass the check before either has inserted. The
`UNIQUE(organization_id, operation, idempotency_key)` constraint moves that decision into the
database: both requests attempt the insert inside their transaction, and only one can win: the
loser gets a unique-violation instead of racing consistency.

- `requestFingerprint` (a hash of the canonicalized request payload) is intended to let
  application code tell a genuine retry (same key, same fingerprint → replay the stored
  response) apart from a key reused for a different request (same key, different fingerprint
  → reject with a conflict).
- `state` (`in_progress` / `completed` / `failed`) is intended to let a concurrent request
  that loses the insert race decide whether to wait, retry, or fail immediately.
- A `CHECK` constraint enforces that a row marked `completed` always has a `response_status`
  — you cannot mark something done without recording what "done" produced.
- `expiresAt` documents an intended cleanup policy; no expiry job exists yet.

As of Milestone 3, this is exactly how the inventory/reservation write paths use the table —
see [inventory.md#idempotency](inventory.md#idempotency) for the full request-handling logic
built on top of this schema.

## Migration procedures

Migrations are managed with drizzle-kit and committed to `apps/api/drizzle/`.

```bash
# Generate a new migration after changing schema files in src/database/schema/
pnpm --filter @fulfillos/api db:generate

# Review the generated SQL in apps/api/drizzle/ before applying it anywhere.

# Apply pending migrations to whatever DATABASE_URL points at
DATABASE_URL=postgresql://fulfillos:fulfillos@localhost:5432/fulfillos \
  pnpm --filter @fulfillos/api db:migrate

# Apply pending migrations to the integration test database instead
DATABASE_URL_TEST=postgresql://fulfillos:fulfillos@localhost:5432/fulfillos_test \
  pnpm --filter @fulfillos/api db:migrate:test
```

drizzle-kit's migrator tracks applied migrations in a `drizzle.__drizzle_migrations` table;
re-running `db:migrate` against a database that already has a migration applied is a no-op
(verified locally — see the Milestone 1 checkpoint report). There is no destructive
schema-sync command in this project's normal workflow — schema changes always go through a
reviewed, committed SQL migration file.

## Known limitations

- **Append-only is not yet database-enforced.** `audit_log`'s immutability is currently an
  application convention; the database role the app connects as can still UPDATE/DELETE rows.
  Enforcing this with database-level permissions (a restricted role without UPDATE/DELETE
  grants on this table) is a documented future improvement, not yet implemented.
- **No idempotency-key expiry job.** `expiresAt` is a column with a default, not an active
  cleanup process.
- **No multi-warehouse inventory.** One inventory row per product, matching the MVP scope in
  ADR-002; a location/warehouse dimension is not modeled and would require a schema change.
- **`audit_log.resource_id` has no referential integrity** — it's free-form text, not a
  foreign key, because a generic audit log spans many different resource types. A resource
  can be deleted after an audit row references it; that's expected for an audit trail, but it
  means a stale `resource_id` cannot be distinguished from a typo by the database.
- **RLS is not enabled** — see the Tenant isolation section above for why, and what would need
  to exist first.
