# Milestone 1 — Domain and Database Engineering (local backlog)

This is a local, offline backlog. GitHub authentication is currently unavailable in this
environment, so these are **not** GitHub Issues yet — no issue numbers are implied or
referenced anywhere in commit messages or code. When GitHub access is restored, each item
below should become a real Issue, and this file updated to link to it (or removed once
GitHub Issues are the source of truth).

Status values used below: `not started`, `in progress`, `done`.

---

## M1-01: Core identity and organization schema

**Problem statement**
Milestone 2 (authentication and tenancy) needs a schema for users, organizations, and
memberships to build on. None exists yet.

**Scope**
Drizzle schema definitions for `organizations`, `users`, `memberships` tables, with the
constraints needed for tenant isolation and duplicate prevention. No authentication logic,
no session handling — schema only.

**Acceptance criteria**
- `organizations`, `users`, `memberships` tables defined as typed Drizzle schema.
- Users have a case-insensitive-unique, normalized email (DB-enforced, not just app convention).
- Memberships have a `(organization_id, user_id)` uniqueness constraint (no duplicate membership).
- Membership role is constrained to a defined enum.
- A `password_hash` column exists with a documented intended hashing strategy; no demo
  credentials are inserted anywhere.
- Migration generated and applied cleanly to a disposable Postgres database.

**Dependencies**: none.

**Tests**
- Integration: duplicate organization id rejected (PK), duplicate user email (any casing)
  rejected, duplicate membership rejected, invalid role rejected.

**Completion status**: not started

---

## M1-02: Product and inventory schema

**Problem statement**
Milestone 3 (catalog and inventory) needs an organization-scoped product catalog and an
inventory model whose invariants (`on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`)
are enforced by the database, not just application code.

**Scope**
Drizzle schema for `products` and `inventory` (plus an `inventory_movements` ledger table
for future traceability). No reservation logic — this milestone only prepares the schema
Milestone 3's transactional reservation logic will run against.

**Acceptance criteria**
- SKU uniqueness scoped per organization, case-insensitive and trimmed, DB-enforced.
- One inventory row per product (`UNIQUE(product_id)`), composite foreign key ties
  `inventory.(product_id, organization_id)` to `products.(id, organization_id)` so an
  inventory row can never reference a product from a different organization.
- CHECK constraints enforce `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`.
- `inventory_movements` ledger table exists (schema only — nothing writes to it yet;
  Milestone 3 will insert rows as part of reservation/release transactions).

**Dependencies**: M1-01 (organizations table).

**Tests**
- Integration: duplicate SKU within an org rejected; identical SKU across two different
  orgs allowed; negative on-hand/reserved rejected; reserved > on_hand rejected; inventory
  row referencing a product from a different organization rejected.

**Completion status**: not started

---

## M1-03: Orders, idempotency, and audit schema

**Problem statement**
Milestone 4 (orders) and Milestone 3 (idempotent reservations) need a persisted, tenant-safe
order model and a database-backed idempotency mechanism; the whole system needs a minimal
audit trail. None of this exists yet.

**Scope**
Drizzle schema for `orders`, `order_items`, `idempotency_keys`, `audit_log`. No order-service
business logic, no actual idempotency-key checking code, no audit-writing code — schema only.

**Acceptance criteria**
- `order_items` cannot reference a product from a different organization than its parent
  order (composite foreign keys on both `orders` and `products`).
- Monetary values stored as integer minor units (cents), never floating point.
- A minimal order status lifecycle is defined as an enum and documented (not enforced as a
  transition state machine at the DB layer — that belongs to the application layer).
- `idempotency_keys` has a DB-enforced unique constraint on
  `(organization_id, operation, idempotency_key)`, plus columns for a request fingerprint,
  processing state, and a persisted response, so the application layer (Milestone 3) can
  reject a reused key with a different payload and safely replay a reused key with the same
  payload.
- `audit_log` never has columns for passwords, session secrets, or tokens.

**Dependencies**: M1-01, M1-02.

**Tests**
- Integration: order item referencing another org's product rejected; duplicate
  idempotency key (same org + operation + key) rejected; invalid foreign keys rejected;
  audit record foreign keys enforced as documented (actor optional, organization required).

**Completion status**: not started

---

## M1-04: Migrations and seed tooling

**Problem statement**
Schema changes need to be reproducible and reviewable, and local development needs
realistic, safe, non-destructive sample data.

**Scope**
drizzle-kit migration generation/apply scripts, and an idempotent seed script restricted to
non-production environments.

**Acceptance criteria**
- `pnpm --filter @fulfillos/api db:generate` produces reviewable SQL migration files
  committed to the repo.
- `pnpm --filter @fulfillos/api db:migrate` applies them to whichever database
  `DATABASE_URL` points at.
- Running migrations twice does not error or corrupt data.
- Seed script creates one fictional organization + a small product/inventory catalog with
  deterministic ids; running it twice does not create duplicates.
- Seed script refuses to run when `NODE_ENV=production`.

**Dependencies**: M1-01, M1-02, M1-03.

**Tests**: seed script run twice against a disposable database, verified row counts stay
constant on the second run.

**Completion status**: not started

---

## M1-05: PostgreSQL integration test infrastructure

**Problem statement**
The correctness guarantees above (uniqueness, tenant isolation, check constraints) are only
real if they're tested against an actual PostgreSQL instance, not mocked.

**Scope**
An integration test harness (separate Jest project from unit tests) that runs migrations
against an isolated test database and exercises the constraints defined in M1-01–M1-03.

**Acceptance criteria**
- Integration tests connect only to a database whose name/URL is explicitly the test
  database (`DATABASE_URL_TEST`), never the dev database, with a guard that refuses to run
  if that isn't the case.
- All 12 constraint/behavior cases from the milestone brief are covered (see
  `apps/api/test/integration/`).
- CI runs these against a real Postgres service container.

**Dependencies**: M1-01, M1-02, M1-03, M1-04.

**Tests**: this item *is* the tests — see acceptance criteria.

**Completion status**: not started
