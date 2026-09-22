# Changelog

All notable changes to FulfillOS are documented in this file.

## [1.0.0] — Milestone 6: Final Engineering & Release Readiness

First release candidate. Combines Milestones 0–5 (below) with final release-readiness work.

### Added

- A Playwright test (`apps/web/e2e/order-conflict.spec.ts`) covering the browser-level behavior
  when two clients attempt conflicting order transitions: exactly one succeeds, the loser gets a
  real conflict response (never a false success), and the UI refreshes to authoritative state.
  This closes the one gap identified in the Milestone 5 checkpoint — see
  [docs/backlog/milestone-6.md](docs/backlog/milestone-6.md) for how its scope is distinguished
  from the existing real-Postgres concurrency test it complements, not replaces.
- `docs/backlog/milestone-6.md`, classifying release-readiness work as P0/P1/P2 and recording
  the security and transactional-correctness audit findings.
- README `Deployment` and `Security considerations` sections, and an inline architecture diagram.

### Fixed

- **Order detail page**: the fulfill/cancel confirmation dialogs could reopen, still showing a
  live "Cancel order" or "Fulfill order" button, after a transition attempt failed with a 409
  conflict and the page reloaded — even though the order had already reached a terminal state.
  Found while writing the new conflict test, not before. Both dialogs now render only while the
  order is actually `pending`.
- `CreateReservationDto.currency` was missing `@IsString()` before its `@Length(3, 3)` check —
  found during the release security audit. Not a security bypass (nothing trusts this field for
  anything but a fixed-width column write), but inconsistent with every other DTO's explicit
  typing.

### Security

- Full release security audit performed against the running code (not just prior
  documentation): password hashing, session lifecycle, cookie configuration, CSRF coverage on
  every mutating route, rate-limiter key construction, tenant isolation, input validation, error
  handling, CORS, frontend caching, environment/secrets, logging, and security headers. No new
  critical/high/medium findings — see [docs/backlog/milestone-6.md](docs/backlog/milestone-6.md)
  for the full write-up.
- Dependency vulnerability audit (`pnpm audit`, 32 advisories at time of audit): reviewed each
  for actual reachability rather than raw count. Confirmed unreachable: 8 Multer advisories (no
  file-upload endpoint exists) and `@nestjs/core`'s CVE-2026-35515 (requires a `@Sse()` endpoint
  mapping user input into SSE fields; none exists). The remainder are transitive build-tool
  dependencies (webpack, ts-loader, ESLint's config loader) never present in a deployed
  instance's runtime. No safe non-major update closes the one framework-level advisory found; a
  NestJS 11 migration is deferred as an accepted, tracked risk rather than an unnecessary major
  version upgrade under this milestone's deadline.
- Documented a pre-launch checklist item: enabling Express's `trust proxy` in a future
  reverse-proxy deployment must be done deliberately, since the rate limiter's Redis key is
  currently keyed on the direct socket address specifically because `trust proxy` is unset.

### Verified (no code change; confirmed correct)

- All documented transactional invariants for inventory and orders (`on_hand >= 0`,
  `reserved >= 0`, `reserved <= on_hand`, atomic multi-product reservations, exactly-once
  cancellation/fulfillment, idempotency-key conflict rejection, consistent lock ordering across
  reservation/release/fulfillment/adjustment) — re-reviewed against the actual code, not
  re-derived from the docs alone.
- Fresh-environment reproducibility: migrations apply cleanly to a brand-new, isolated
  PostgreSQL instance with no manual ownership fixes; the development seed script refuses to run
  under `NODE_ENV=production`; the distinct test-database role cannot connect to the development
  database; both production builds run their production `start` command successfully against a
  fresh database.
- 154 backend tests (3 unit, 94 integration, 55 security, 2 e2e), 22 frontend component tests,
  and 15 Playwright browser tests (14 from Milestone 5 plus the new conflict test) all pass.

## [0.5.0] — Milestone 5: Enterprise Dashboard & Full-Stack Integration

- Complete Next.js dashboard: registration, login, logout, organization switching, an
  operational overview backed by a new database-aggregated summary endpoint, product management,
  inventory viewing/adjustment, multi-line order creation, and order fulfillment/cancellation —
  all against the real API, no mocked business data.
- shadcn/ui (Base UI) design system, a typed API client, idempotency-key handling for every
  mutating workflow, and organization-switch tenant isolation via a remount-on-switch strategy.
- Vitest + React Testing Library component tests; an expanded, self-managing Playwright suite
  (its own isolated test database and Redis logical database, pre-warmed dev-server routes) with
  5 new flow specs (product fulfillment, cancellation, permissions, tenant isolation, failure
  handling) alongside the existing auth flow.
- CI updated to run frontend component tests and the Playwright suite.

## [0.4.0] — Milestone 4: Product Catalog & Order Fulfillment

- Tenant-scoped product catalog with atomic inventory initialization on creation.
- Order management API: paginated listing/retrieval, transactional fulfillment consuming a
  reservation, order-centric cancellation reusing the existing release logic.
- OpenAPI/Swagger documentation of the running API.

## [0.3.0] — Milestone 3: Inventory & Reservation Engine

- Concurrency-safe inventory engine: stock adjustments, atomic multi-product reservations with
  deterministic row-level lock ordering, transactional idempotency-key handling, reservation
  release/cancellation.
- PostgreSQL integration tests proving the concurrency/idempotency/rollback guarantees against
  real concurrent connections.

## [0.2.0] — Milestone 2: Authentication, Sessions & Multi-Tenant Authorization

- Database-backed sessions (Argon2id password hashing, idle/absolute expiration), a session-bound
  CSRF synchronizer token, Redis-backed rate limiting on auth endpoints, and organization
  membership/role authorization.
- A real Next.js authentication vertical slice calling the live API.
- An HTTP-level security test suite (credentials, sessions, CSRF, tenancy, rate limiting).

## [0.1.0] — Milestone 1: Repository Foundation & Domain/Database Engineering

- pnpm workspace (`apps/api` NestJS, `apps/web` Next.js); Docker Compose for local PostgreSQL and
  Redis, including a distinct, non-superuser test-database role with no access to the
  development database.
- Full database schema (organizations, users, memberships, products, inventory, inventory
  movements, orders, order items, idempotency keys, audit log, sessions) with tenant-isolation
  constraints, migrations, and an idempotent seed script.
- Shared TypeScript/lint/format tooling and the initial CI pipeline.

## [0.0.0] — Milestone 0: Repository Bootstrap

- Initial README, contributing/security guides, and the first architecture decision records.
