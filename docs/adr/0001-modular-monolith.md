# ADR-001: Modular Monolith Architecture

## Status

Accepted

## Context

FulfillOS needs clear domain boundaries (organizations, auth, catalog, inventory, orders, audit) so three developers can work concurrently without constantly colliding, while shipping a working MVP in a three-day sprint.

## Decision

Build a single deployable NestJS application (`apps/api`) organized as a modular monolith: one NestJS module per domain, each owning its own controllers, services, DTOs, and persistence access. Modules communicate through the providers they explicitly export, not by reaching into each other's internals. A separate Next.js application (`apps/web`) consumes the API over HTTP.

## Alternatives considered

- **Microservices per domain**: rejected. Adds network boundaries, deployment complexity, and distributed-transaction problems (inventory reservation needs strong consistency) that are unjustified at this scale and timeline.
- **Single undifferentiated NestJS app with no module boundaries**: rejected. Would let business logic bleed across domains and make it hard for multiple developers to work in parallel without conflicts.

## Consequences

- Simple deployment and local development (one process, one database).
- Domain boundaries are enforced by convention and module exports, not by a hard process boundary — a determined developer can still violate them; code review is the backstop.
- If a domain later needs independent scaling or deployment, extracting it means drawing out an already-isolated module rather than untangling a shared codebase.
