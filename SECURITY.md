# Security Policy

## Reporting a vulnerability

This is a portfolio/learning project, not a production service handling real customer data. If you find a security issue, please open a GitHub issue with the `area:security` label, or contact the repository owner (@LMichy1) directly rather than filing a public issue for anything sensitive.

## Current security posture

As of this writing (Milestone 0), the application has no authentication, authorization, or tenancy enforcement implemented yet. **No endpoint in this repository should be treated as security-reviewed or deployed publicly with real data.** This section will be updated as each control is implemented; see the [ADRs](docs/adr/) for the intended design.

Planned/intended controls (see [ADR-003](docs/adr/0003-multi-tenant-authorization.md) for detail):

- Server-side sessions via secure, `HttpOnly`, `SameSite` cookies (not client-trusted JWTs).
- CSRF protection on cookie-authenticated mutations.
- Password hashing for locally stored credentials.
- Organization-scoped authorization enforced server-side on every request, never trusting a client-supplied organization id.
- Role-based permissions within an organization.
- Input validation on all API inputs.
- Rate limiting on sensitive endpoints (auth, etc.).

## Known limitations

- Development-only shortcuts, if any are introduced for local iteration speed, must be isolated behind environment checks and never reachable in a production build. None currently exist.
- This document will be kept in sync with what is actually implemented, not with what is planned.
