# FulfillOS

A multi-tenant inventory and order management platform. Organizations manage their own products, stock, staff, and customer orders through a shared application with strict tenant isolation.

## Status

**Milestones 0–3 complete** (repository foundation; domain and database engineering;
authentication, sessions, and multi-tenant authorization; the transactional inventory and
reservation engine). This README describes what is actually implemented today, not the full
target feature set. See [Known limitations](#known-limitations) below and the milestone plan
in the project brief for what's next.

Implemented so far:

- pnpm workspace with `apps/api` (NestJS) and `apps/web` (Next.js)
- API health endpoints (`GET /health`, `GET /health/ready` — the latter checks database connectivity)
- Docker Compose services for local PostgreSQL and Redis, including a separate database — and, as of Milestone 3, a distinct, non-superuser role with no access to the development database — for integration tests
- Full database schema (organizations, users, memberships, products, inventory, inventory movements, orders, order items, idempotency keys, audit log, sessions) with tenant-isolation constraints, migrations, and an idempotent seed script — see [docs/architecture/database.md](docs/architecture/database.md)
- Database-backed session authentication (Argon2id password hashing, session-bound CSRF tokens, idle/absolute session expiration, Redis-backed rate limiting on auth endpoints), and organization membership/role authorization — see [docs/architecture/authentication.md](docs/architecture/authentication.md)
- A concurrency-safe inventory and reservation engine (stock adjustments, atomic multi-product reservations with row-level locking in deterministic order, transactional request idempotency, and reservation release/cancellation) exposed as a tenant-scoped, role-enforced HTTP API — see [docs/architecture/inventory.md](docs/architecture/inventory.md)
- A real Next.js authentication vertical slice (registration, login, an authenticated dashboard with an organization switcher and an owner-only rename form, logout) calling the real API — no mocked auth
- PostgreSQL integration tests (schema constraints/tenant isolation, and — as of Milestone 3 — concurrency/idempotency/rollback tests against real concurrent connections) and a separate HTTP-level security test suite (credentials, sessions, CSRF, tenancy, rate limiting, and the new inventory/reservation endpoints) against a real database and real Redis, plus a Playwright browser test of the auth flow
- Shared TypeScript/lint/format config, CI pipeline (install, format check, lint, typecheck, unit tests, PostgreSQL integration tests, security tests, build)

Not yet implemented: a product-creation/catalog HTTP API, order fulfillment beyond reservation
(no `pending → fulfilled` transition), organization invitations, account recovery. See the
[architecture overview](docs/architecture/overview.md) for the target design.

## Technology stack

| Component        | Technology                        |
| ---------------- | --------------------------------- |
| Language         | TypeScript (strict mode)          |
| Backend          | NestJS                            |
| Frontend         | Next.js (App Router)              |
| UI               | Tailwind CSS, shadcn/ui           |
| Database         | PostgreSQL                        |
| ORM              | Drizzle ORM                       |
| Cache / jobs     | Redis, BullMQ (added when needed) |
| Package manager  | pnpm workspaces                   |
| Backend testing  | Jest                              |
| Frontend testing | Vitest, React Testing Library     |
| E2E testing      | Playwright                        |
| API docs         | OpenAPI / Swagger                 |
| Containers       | Docker, Docker Compose            |
| CI/CD            | GitHub Actions                    |

## Architecture

See [docs/architecture/overview.md](docs/architecture/overview.md) for the system diagram and domain boundaries, [docs/architecture/database.md](docs/architecture/database.md) for the schema/ER diagram/tenant-isolation strategy, [docs/architecture/authentication.md](docs/architecture/authentication.md) for the auth/session/CSRF/authorization design and threat model, [docs/architecture/inventory.md](docs/architecture/inventory.md) for the inventory/reservation engine (transaction boundaries, lock order, idempotency, reservation lifecycle), and [docs/adr/](docs/adr/) for the architecture decision records:

- [ADR-001: Modular Monolith Architecture](docs/adr/0001-modular-monolith.md)
- [ADR-002: PostgreSQL Inventory Consistency](docs/adr/0002-postgres-inventory-consistency.md)
- [ADR-003: Multi-Tenant Authorization](docs/adr/0003-multi-tenant-authorization.md)
- [ADR-004: CSRF via Session-Bound Synchronizer Token](docs/adr/0004-csrf-session-bound-synchronizer-token.md) (supersedes ADR-003's CSRF detail)

## Prerequisites

- Node.js 20+ (developed against Node 22)
- pnpm 9+ (developed against pnpm 11.6.0)
- Docker and Docker Compose

## Local setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables
cp .env.example .env

# 3. Start Postgres (with a separate integration-test database, owned by its own distinct
#    non-superuser role with no access to the development database — see
#    docker/postgres-init/01-create-test-db.sh) and Redis
docker compose up -d

# 4. Apply database migrations
pnpm --filter @fulfillos/api db:migrate

# 5. (optional) Seed a fictional organization, products, and inventory
pnpm --filter @fulfillos/api db:seed

# 6. Run the API (http://localhost:3001)
pnpm dev:api

# 7. Run the web app (http://localhost:3000)
pnpm dev:web

# 8. Visit http://localhost:3000/register to create an account and organization
```

## Environment variables

See [.env.example](.env.example) for the full list with defaults. Never commit a real `.env` file.

## Database migrations

Managed with drizzle-kit; migration SQL is committed to `apps/api/drizzle/`. See [docs/architecture/database.md](docs/architecture/database.md#migration-procedures) for the full workflow. Quick reference:

```bash
# After changing a schema file in apps/api/src/database/schema/, generate a migration
pnpm --filter @fulfillos/api db:generate

# Apply pending migrations to the dev database (DATABASE_URL)
pnpm --filter @fulfillos/api db:migrate

# Apply pending migrations to the integration test database (DATABASE_URL_TEST)
pnpm --filter @fulfillos/api db:migrate:test
```

## Tests

```bash
pnpm test        # unit tests, all workspaces
pnpm lint         # lint, all workspaces
pnpm typecheck    # type check, all workspaces
pnpm format:check # formatting check

# PostgreSQL integration tests (schema constraints, tenant isolation, and the inventory/
# reservation engine's concurrency, idempotency, and rollback guarantees against real,
# concurrently-connected Postgres — requires DATABASE_URL_TEST to point at a real, disposable
# database whose name contains "test", ideally under its own distinct role as provisioned by
# docker compose; the test harness re-verifies the live connection's database identity before
# every destructive operation)
pnpm --filter @fulfillos/api test:integration

# HTTP-level security tests: credentials, sessions, CSRF, tenancy, rate limiting, and the
# inventory/reservation endpoints (cross-tenant access, role enforcement, CSRF, the required
# Idempotency-Key header)
# (requires DATABASE_URL_TEST and REDIS_URL_TEST — see .env.example)
pnpm --filter @fulfillos/api test:security

# Playwright browser test of the auth vertical slice — requires both dev servers already
# running (docker compose up -d, then pnpm dev:api and pnpm dev:web in separate terminals)
pnpm --filter @fulfillos/web test:e2e
```

## API documentation

Not yet available as generated OpenAPI/Swagger — that wiring is still planned. See
[docs/architecture/authentication.md](docs/architecture/authentication.md#api-endpoints) for
the auth/organizations endpoints and
[docs/architecture/inventory.md](docs/architecture/inventory.md#api) for the inventory/
reservation endpoints, including example requests.

## Known limitations

- Authentication and organization-membership/role authorization are implemented and tested for the endpoints listed in [docs/architecture/authentication.md](docs/architecture/authentication.md#api-endpoints). The inventory/reservation engine (below) reuses this same authorization mechanism; no product-creation/catalog HTTP endpoints exist yet.
- No order fulfillment workflow — reservations can be created and released, but there is no `pending → fulfilled` transition. See [Known limitations in inventory.md](docs/architecture/inventory.md#known-limitations) for the full list.
- No organization invitation flow, account recovery, or email verification — see [Known limitations in authentication.md](docs/architecture/authentication.md#known-limitations) for the full list and reasoning.
- No Content-Security-Policy or systematic output-encoding audit on the frontend.
- `audit_log`'s append-only nature is an application convention, not yet a database-enforced guarantee (no restricted database role exists yet).
- CI does not run the Playwright browser test — it requires both dev servers already running, which CI doesn't orchestrate yet. Run it locally with `pnpm --filter @fulfillos/web test:e2e` (see [Tests](#tests)).

## Future improvements

Tracked as GitHub Issues once the repository and issue tracker are fully set up (see project brief milestones 1–6).
