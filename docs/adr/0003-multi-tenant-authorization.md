# ADR-003: Multi-Tenant Authorization Strategy

## Status

Accepted

## Context

FulfillOS is multi-tenant: multiple organizations share the same database and application instance. A bug that lets one organization read or modify another's data (including by guessing resource identifiers) is a critical security failure, not just a bug.

## Decision

- Authentication uses server-side sessions, not client-trusted JWTs: on login, the API creates a session record in Postgres and returns an opaque session identifier in a `Secure` (in production), `HttpOnly`, `SameSite=Lax` cookie. This allows immediate session revocation and avoids storing authorization claims in a token the client can hold onto after a permission change.
- Every organization-scoped request resolves the acting user's organization membership and role from the authenticated session server-side. The organization id embedded in a URL or request body is never trusted on its own — it is always checked against the caller's actual memberships before any read or write.
- Mutating, cookie-authenticated requests require an explicit CSRF token (double-submit pattern) in addition to the session cookie.
- Role-based permissions (e.g. owner, staff) gate which operations a member of an organization may perform within that organization.

## Alternatives considered

- **Stateless JWT-based auth**: rejected for this MVP. JWTs would need short expiries plus a refresh/revocation mechanism to be safe, which reintroduces most of the complexity of server-side sessions without their simplicity advantage — and a leaked long-lived JWT can't be revoked without extra infrastructure.
- **Trusting an `organizationId` supplied by the client**: rejected outright — this is the exact cross-tenant vulnerability the spec calls out. Authorization must be derived from the authenticated session's memberships, never from client-supplied identifiers.

## Consequences

- Tenant isolation must be tested explicitly: automated tests prove that a user from Organization A cannot access or modify Organization B's data, including by guessing resource identifiers.
- Server-side sessions require a database round trip (or cache) to validate each request; acceptable at this scale and avoided from being a bottleneck by indexing the session lookup.
- This ADR documents the intended design. Its guarantees hold only once the corresponding auth and tenancy modules are implemented and covered by the cross-tenant integration tests described in the project brief — see the README's "Known limitations" section for current implementation status.
