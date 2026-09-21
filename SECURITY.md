# Security Policy

## Reporting a vulnerability

This is a portfolio/learning project, not a production service handling real customer data. If you find a security issue, please open a GitHub issue with the `area:security` label, or contact the repository owner (@LMichy1) directly rather than filing a public issue for anything sensitive.

## Current security posture

As of Milestone 2, the following are implemented and covered by automated tests (see
[docs/architecture/authentication.md](docs/architecture/authentication.md) for the full design
and threat model, and its "Security tests" section for what's actually tested):

- Server-side, database-backed sessions via opaque tokens in secure, `HttpOnly`, `SameSite`
  cookies — not client-trusted JWTs.
- A session-bound synchronizer CSRF token (see
  [ADR-004](docs/adr/0004-csrf-session-bound-synchronizer-token.md)) on cookie-authenticated
  mutating requests.
- Argon2id password hashing (not a home-grown scheme), with a generic invalid-credentials
  response that doesn't distinguish an unknown account from a wrong password.
- Organization-scoped authorization enforced server-side on every request via database
  membership/role lookups, never trusting a client-supplied organization id or role.
- Input validation on all API inputs (`class-validator` DTOs, `whitelist`/
  `forbidNonWhitelisted`).
- Redis-backed rate limiting on `/auth/register` and `/auth/login`.

**Still no endpoint beyond the ones listed in
[authentication.md's API endpoints](docs/architecture/authentication.md#api-endpoints) exists
to be reviewed** — no product/order HTTP surface yet. Do not treat this as an independent
security audit or a production-readiness certification.

## Known limitations

- No organization invitation flow, account recovery, or email verification — see
  [authentication.md's Known limitations](docs/architecture/authentication.md#known-limitations)
  for the full list and reasoning.
- No Content-Security-Policy or systematic output-encoding audit on the frontend.
- Timing-based login enumeration via response latency is narrowed (a real password hash
  verification always runs) but not eliminated.
- `audit_log`'s append-only nature is an application convention, not yet a database-enforced
  guarantee (no restricted database role exists yet).
- Development-only shortcuts, if any are introduced for local iteration speed, must be isolated behind environment checks and never reachable in a production build. None currently exist.
- This document will be kept in sync with what is actually implemented, not with what is planned.
