# Architecture Overview

## Status

This document describes the target architecture for the MVP. Implemented and tested: `auth`
and `organizations` (Milestone 2, see [authentication.md](authentication.md)); `inventory` and
a `reservations` module covering the `orders`/`order_items` slice of the diagram below
(Milestone 3, see [inventory.md](inventory.md)); `catalog` (product creation/queries) and an
`orders` module covering listing, retrieval, fulfillment, and cancellation (Milestone 4, see
[order-lifecycle.md](order-lifecycle.md)). `audit` (a queryable API over the existing
append-only log) remains a target design, not yet built as its own module. See the root
README's "Known limitations" section for current status.

## System context

```mermaid
flowchart LR
    User[Browser] -->|HTTPS| Web[apps/web<br/>Next.js App Router]
    Web -->|REST, cookies| Api[apps/api<br/>NestJS]
    Api -->|SQL, transactions| Postgres[(PostgreSQL)]
    Api -->|jobs / cache| Redis[(Redis)]
```

## Modular monolith: domain boundaries inside apps/api

```mermaid
flowchart TB
    subgraph API[apps/api]
        Organizations[organizations<br/>orgs + memberships]
        Auth[auth<br/>sessions + roles]
        Catalog[catalog<br/>products]
        Inventory[inventory<br/>stock + reservations]
        Orders[orders<br/>order lifecycle]
        Audit[audit<br/>append-only event log]
    end
    Auth --> Organizations
    Orders --> Inventory
    Orders --> Catalog
    Orders --> Organizations
    Inventory --> Organizations
    Catalog --> Organizations
    Orders --> Audit
    Inventory --> Audit
```

Each module owns its own controllers, services, and persistence access, and is only reached through the providers it exports. See [ADR-001](../adr/0001-modular-monolith.md) for the reasoning behind this boundary.

## Inventory consistency

Inventory correctness (preventing overselling under concurrent orders) is the project's central technical challenge. The concurrency-control strategy — row-level locking, deterministic lock ordering, and database-enforced idempotency — is documented in [ADR-002](../adr/0002-postgres-inventory-consistency.md) and implemented and tested as of Milestone 3 (see [inventory.md](inventory.md)).

## Multi-tenancy and authorization

Tenant isolation and the session-based auth strategy are documented in [ADR-003](../adr/0003-multi-tenant-authorization.md) and [ADR-004](../adr/0004-csrf-session-bound-synchronizer-token.md). Both the relational half (composite foreign keys preventing cross-tenant references at the database level — see [docs/architecture/database.md](database.md)) and the application-layer half (session-bound authentication, membership/role authorization) are implemented and tested — see [docs/architecture/authentication.md](authentication.md).

## Database

Schema, entity-relationship diagram, tenant isolation strategy, and migration procedures are documented separately in [docs/architecture/database.md](database.md).
