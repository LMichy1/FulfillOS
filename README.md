# FulfillOS

A multi-tenant inventory and order management platform. Organizations manage their own products, stock, staff, and customer orders through a shared application with strict tenant isolation.

## Status

**Milestone 1 (domain and database engineering) complete; Milestone 0 (repository foundation) complete.** This README describes what is actually implemented today, not the full target feature set. See [Known limitations](#known-limitations) below and the milestone plan in the project brief for what's next.

Implemented so far:

- pnpm workspace with `apps/api` (NestJS) and `apps/web` (Next.js) scaffolds
- API health endpoints (`GET /health`, `GET /health/ready` — the latter now actually checks database connectivity)
- Docker Compose services for local PostgreSQL and Redis, including a separate database for integration tests
- Full database schema (organizations, users, memberships, products, inventory, inventory movements, orders, order items, idempotency keys, audit log) with tenant-isolation constraints, migrations, and an idempotent seed script — see [docs/architecture/database.md](docs/architecture/database.md)
- A PostgreSQL integration test suite covering constraint and tenant-isolation behavior against a real database
- Shared TypeScript/lint/format config, CI pipeline (install, format check, lint, typecheck, unit tests, PostgreSQL integration tests, build)

Not yet implemented: authentication, session/tenancy enforcement at the API layer, product/order HTTP endpoints, inventory reservation logic, and the dashboard. See the [architecture overview](docs/architecture/overview.md) for the target design.

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

See [docs/architecture/overview.md](docs/architecture/overview.md) for the system diagram and domain boundaries, [docs/architecture/database.md](docs/architecture/database.md) for the schema/ER diagram/tenant-isolation strategy, and [docs/adr/](docs/adr/) for the architecture decision records:

- [ADR-001: Modular Monolith Architecture](docs/adr/0001-modular-monolith.md)
- [ADR-002: PostgreSQL Inventory Consistency](docs/adr/0002-postgres-inventory-consistency.md)
- [ADR-003: Multi-Tenant Authorization](docs/adr/0003-multi-tenant-authorization.md)

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

# 3. Start Postgres (with a separate integration-test database) and Redis
docker compose up -d

# 4. Apply database migrations
pnpm --filter @fulfillos/api db:migrate

# 5. (optional) Seed a fictional organization, products, and inventory
pnpm --filter @fulfillos/api db:seed

# 6. Run the API (http://localhost:3001)
pnpm dev:api

# 7. Run the web app (http://localhost:3000)
pnpm dev:web
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

# PostgreSQL integration tests (requires DATABASE_URL_TEST to point at a real, disposable
# database whose name contains "test" — docker-compose's fulfillos_test satisfies this)
pnpm --filter @fulfillos/api test:integration
```

Playwright end-to-end tests will be added starting in Milestone 5, once there are frontend screens to exercise; this README will be updated with their commands once they exist.

## API documentation

Not yet available — OpenAPI/Swagger wiring is planned once the first real endpoints beyond health checks exist.

## Known limitations

- No authentication, authorization, or tenancy enforcement at the API layer yet — do not treat any current endpoint as security-reviewed. The database schema enforces _relational_ tenant integrity (see [docs/architecture/database.md](docs/architecture/database.md#tenant-isolation-strategy)), which is a different guarantee from authorization.
- No application code reads or writes the database yet beyond the health-check readiness probe — no product/order HTTP endpoints, no inventory reservation logic.
- No frontend screens beyond the default Next.js scaffold.
- `audit_log`'s append-only nature is an application convention, not yet a database-enforced guarantee (no restricted database role exists yet).
- CI does not yet run E2E tests, because no frontend screens exist yet to exercise.

## Future improvements

Tracked as GitHub Issues once the repository and issue tracker are fully set up (see project brief milestones 1–6).
