# FulfillOS

A multi-tenant inventory and order management platform. Organizations manage their own products, stock, staff, and customer orders through a shared application with strict tenant isolation.

## Status

**Milestone 0 (repository foundation) in progress.** This README describes what is actually implemented today, not the full target feature set. See [Known limitations](#known-limitations) below and the milestone plan in the project brief for what's next.

Implemented so far:

- pnpm workspace with `apps/api` (NestJS) and `apps/web` (Next.js) scaffolds
- API health endpoints (`GET /health`, `GET /health/ready`)
- Docker Compose services for local PostgreSQL and Redis
- Shared TypeScript/lint/format config, CI pipeline (install, format check, lint, typecheck, unit tests, build)

Not yet implemented: authentication, organizations/tenancy, product catalog, inventory, orders, and the dashboard. See the [architecture overview](docs/architecture/overview.md) for the target design.

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

See [docs/architecture/overview.md](docs/architecture/overview.md) for the system diagram and domain boundaries, and [docs/adr/](docs/adr/) for the architecture decision records:

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

# 3. Start Postgres and Redis
docker compose up -d

# 4. Run the API (http://localhost:3001)
pnpm dev:api

# 5. Run the web app (http://localhost:3000)
pnpm dev:web
```

## Environment variables

See [.env.example](.env.example) for the full list with defaults. Never commit a real `.env` file.

## Database migrations

Not yet applicable — no schema or ORM setup exists yet (planned for Milestone 1).

## Tests

```bash
pnpm test        # unit tests, all workspaces
pnpm lint         # lint, all workspaces
pnpm typecheck    # type check, all workspaces
pnpm format:check # formatting check
```

Integration tests (against real PostgreSQL) and Playwright end-to-end tests will be added starting in Milestone 1; this README will be updated with their commands once they exist.

## API documentation

Not yet available — OpenAPI/Swagger wiring is planned once the first real endpoints beyond health checks exist.

## Known limitations

- No authentication, authorization, or tenancy enforcement yet — do not treat any current endpoint as security-reviewed.
- No database schema, migrations, or persistence layer yet.
- No frontend screens beyond the default Next.js scaffold.
- CI does not yet run integration or E2E tests, because none exist yet.

## Future improvements

Tracked as GitHub Issues once the repository and issue tracker are fully set up (see project brief milestones 1–6).
