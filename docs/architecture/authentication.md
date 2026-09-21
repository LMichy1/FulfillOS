# Authentication, Sessions & Multi-Tenant Authorization

## Status

Implemented as of Milestone 2, and covered by the test suites described below: registration
bootstrap, login/logout, database-backed sessions with idle/absolute expiration, a
session-bound CSRF token, and organization membership/role authorization on two endpoints
(`GET /organizations/:id`, `PATCH /organizations/:id`). **Not implemented**: organization
invitations (adding a member to an _existing_ organization), account recovery / password
reset, email verification, and any endpoint beyond the ones listed in
[API endpoints](#api-endpoints) below. This document describes what is actually running, not
a target design — see [Known limitations](#known-limitations) for what's deliberately out of
scope.

## Authentication flow

1. **Register** (`POST /auth/register`): creates a user, a brand-new organization, and an
   owner membership in one transaction. Does not issue a session — registration and login are
   separate operations (see [Design choice: register doesn't auto-issue a session](#design-choice-register-doesnt-auto-issue-a-session)).
2. **Login** (`POST /auth/login`): verifies the email/password, and on success issues a fresh
   session (a new random token, never anything sent before authentication) and a fresh CSRF
   secret, returned via a cookie (session) and via cookie + response body (CSRF token — see
   [CSRF strategy](#csrf-strategy)).
3. Every subsequent request presents the session cookie. `SessionAuthGuard`, applied globally,
   hashes the presented token, looks up the session row, and rejects the request (401) unless
   it's un-revoked and within both its idle and absolute windows.
4. **Logout** (`POST /auth/logout`): revokes the session row server-side and clears both
   cookies. The old cookie value, if replayed, is rejected — revocation is a database write,
   not just clearing the browser's cookie.

## Session lifecycle

Sessions are Postgres rows (`sessions` table), not JWTs or signed cookies — see ADR-003. Two
independent expirations:

- **Idle timeout: 30 minutes.** Recomputed on each "touch" (see below) as
  `now + 30 minutes`. A session left unused past this point is invalid even if its absolute
  lifetime hasn't elapsed.
- **Absolute timeout: 8 hours.** Fixed at session creation, never extended. A session is
  invalid past this point no matter how recently it was used.

Both are **application policy, not a universal security standard** — see
`apps/api/src/auth/session.constants.ts`; change them there if the policy changes.

To avoid a database write on every single request, "touching" a session (extending its idle
window) is throttled: `lastActivityAt` is only rewritten if at least 60 seconds have passed
since the last write (`ACTIVITY_TOUCH_THROTTLE_MS`).

**Session token generation**: `randomBytes(32)` (256 bits of entropy), base64url-encoded. Only
`sha256(token)` is stored (`sessions.token_hash`, unique-indexed) — the raw token, which is
what the cookie holds, never appears in the database. Verifying a presented cookie means
hashing it and looking up that hash; there is no way to reverse a stored hash back into a
usable cookie value.

**Session fixation**: structurally not possible in this design, not just guarded against —
there is no "pre-authentication session" for an attacker to plant and later have promoted.
Every session is created fresh, only at successful login, with a brand-new random token.

## Session storage design

| Column                | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `user_id`             | FK to `users`, cascade on delete                                            |
| `token_hash`          | SHA-256 of the session token; unique, indexed (the per-request lookup path) |
| `csrf_secret_hash`    | SHA-256 of the CSRF secret (see CSRF strategy)                              |
| `created_at`          | Set once, at creation                                                       |
| `last_activity_at`    | Updated by the throttled "touch"                                            |
| `idle_expires_at`     | `last_activity_at + 30 min`, recomputed on touch                            |
| `absolute_expires_at` | `created_at + 8 hours`, never recomputed                                    |
| `revoked_at`          | Nullable; set on logout                                                     |

See `apps/api/drizzle/0001_add_sessions.sql` for the exact DDL and
[docs/architecture/database.md](database.md) for the rest of the schema.

## Cookie configuration

Two cookies, both `Path=/`, `SameSite=Lax`, `Secure` in production only (this project runs
plain HTTP in local development — `apps/web` on :3000, `apps/api` on :3001):

| Cookie                                                                 | `HttpOnly` | Purpose                                                              |
| ---------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `fulfillos.sid` (session name, configurable via `SESSION_COOKIE_NAME`) | Yes        | The session token. Never readable by page JS.                        |
| `fulfillos.csrf` (configurable via `CSRF_COOKIE_NAME`)                 | **No**     | The raw CSRF token — deliberately readable by JS; see CSRF strategy. |

**`localhost:3000` and `localhost:3001` are same-site** (SameSite is defined by registrable
domain, not port), so `SameSite=Lax` cookies are sent on `fetch` requests between them in
local development without any special configuration. They are, however, different _origins_,
which is what CORS governs (see below) — same-site and same-origin are not the same thing.

**Production**: both cookie names are prefixed with `__Host-` (e.g. `__Host-fulfillos.sid`),
which the browser itself refuses to set unless the cookie also has `Secure`, `Path=/`, and no
`Domain` attribute — all three of which are already set, so this is close to free defense in
depth against cookie injection from a sibling subdomain. This requires HTTPS, which is why
it's production-only. A reverse-proxy deployment terminating TLS in front of the API must
forward the connection such that Express/Nest sees it as `Secure` (e.g. `X-Forwarded-Proto`
handled by a trusted proxy config) — not configured in this project, since no such deployment
exists yet.

**CORS**: `app.enableCors({ origin: WEB_ORIGIN, credentials: true, allowedHeaders: [...] })` —
a single explicit trusted origin, read from the `WEB_ORIGIN` environment variable, never a
wildcard (`*` cannot be combined with `credentials: true` per the CORS spec anyway, but this
is also a deliberate choice, not just a spec accident).

## CSRF strategy

See [ADR-004](../adr/0004-csrf-session-bound-synchronizer-token.md) for the full reasoning
(supersedes the "double-submit" wording in ADR-003). Summary:

- At login, a second random secret (independent of the session token) is generated; only its
  hash (`sessions.csrf_secret_hash`) is stored.
- The raw value is returned to the client twice: in the login response body (`csrfToken`) and
  via the readable `fulfillos.csrf` cookie.
- Next.js's `lib/api.ts` reads the **cookie** (not component state) at request time and sends
  it back as the `X-CSRF-Token` header on every mutating request — reading from the cookie
  each time means a rotated token (see `GET /auth/csrf` below) is always picked up correctly
  without extra client-side bookkeeping.
- `CsrfGuard` validates the header against `sessions.csrf_secret_hash` for _that specific
  request's own session_ using `timingSafeEqual` — not "does some cookie match some header"
  in the abstract, which is what makes this a synchronizer token rather than naive
  double-submit.
- `GET /auth/csrf` **rotates** the secret and returns the new raw value. There's no way to
  "retrieve" the original secret handed out at login, since only its hash is ever persisted;
  rotating is how a client recovers a usable token after losing the in-memory/cookie value
  (e.g. a cookie cleared by browser settings). A stale token from a rotated-away or
  since-revoked session is rejected — this is tested (`csrf.security-spec.ts`).
- Unauthenticated routes (register, login) are **not** CSRF-protected — there is no session
  yet to bind a secret to. They rely on narrow CORS and rate limiting instead (see below).

## Organization context

`MembershipGuard` (runs after the global `SessionAuthGuard`) resolves the caller's membership
in the organization named by the `:organizationId` route parameter — never trusting that id by
itself. "Organization doesn't exist" and "organization exists but you're not a member" produce
the identical 404, so the endpoint can't be used to enumerate which organizations exist.
`RolesGuard` then checks the resolved membership's role against an endpoint's `@Roles(...)`
list. Both guards re-derive their answer from the database on every request — nothing about
authorization is cached in the session, so a membership revoked or a role changed mid-session
takes effect on that session's very next request (tested in `tenancy.security-spec.ts`).

This is documented in more detail, alongside the composite-foreign-key relational integrity
it complements, in [docs/architecture/database.md](database.md#tenant-isolation-strategy).

## Role-permission matrix

Two roles exist (`membership_role` enum, defined in Milestone 1 — reconciled with, not
replaced by, this milestone's needs):

| Action                                                         | `owner` | `staff`  |
| -------------------------------------------------------------- | ------- | -------- |
| View an organization they belong to (`GET /organizations/:id`) | ✅      | ✅       |
| Rename an organization (`PATCH /organizations/:id`)            | ✅      | ❌ (403) |
| List their own memberships (`GET /organizations`)              | ✅      | ✅       |

There is currently exactly one role-gated action. Every future organization-scoped write
endpoint must decide, and document here, which role(s) it requires — this table is the single
place that should ever need updating for that.

## API endpoints

All under the existing `/api/v1` prefix (see `apps/api/src/main.ts`):

| Method  | Path                             | Auth                                       | Notes                                          |
| ------- | -------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `POST`  | `/auth/register`                 | Public, rate-limited (5 / 15 min / IP)     | Creates user + org + owner membership          |
| `POST`  | `/auth/login`                    | Public, rate-limited (10 / 15 min / IP)    | Issues session + CSRF cookies                  |
| `POST`  | `/auth/logout`                   | Session + CSRF                             | Revokes the session                            |
| `GET`   | `/auth/me`                       | Session                                    | Current identity, password hash never included |
| `GET`   | `/auth/csrf`                     | Session                                    | Rotates and returns a fresh CSRF token         |
| `GET`   | `/organizations`                 | Session                                    | Caller's own memberships only                  |
| `GET`   | `/organizations/:organizationId` | Session + membership                       | 404 if not a member                            |
| `PATCH` | `/organizations/:organizationId` | Session + membership + CSRF + `owner` role | Rename only                                    |
| `GET`   | `/health`, `/health/ready`       | Public (`@Public()`)                       | Unaffected by this milestone                   |

## Design choice: register doesn't auto-issue a session

Registration and login are modeled as separate operations rather than registration
auto-logging the new user in. The Next.js client calls `POST /auth/login` immediately after a
successful `POST /auth/register` (two round trips, not hidden inside the API). This keeps
`AuthService.register()` and `AuthService.login()` independently simple and independently
testable, at the cost of one extra HTTP round trip client-side.

## Rate limiting and failure handling

`RateLimitGuard` is a Redis-backed fixed-window limiter (`INCR` + `EXPIRE`), keyed by
`request.ip` and route — consistent across multiple API instances sharing the same Redis,
unlike a per-process in-memory counter. `request.ip` is Express's own resolution of the direct
socket address; this project does **not** enable Express's `trust proxy` setting, so
`X-Forwarded-For` is never trusted. A production deployment behind a real reverse proxy would
need to configure `trust proxy` deliberately and understand its implications before relying on
`request.ip` there.

No account-lockout mechanism exists (deliberately — a per-IP rate limit protects the account
without letting an attacker lock a real user out by repeatedly failing their password). Session
validation fails closed: if the database is unreachable, `SessionAuthGuard`'s query throws and
the request is rejected, not silently treated as authenticated.

Passwords, session tokens, and CSRF secrets are never logged; NestJS's default logger is not
configured to log request bodies at all.

## Threat model

**In scope, and mitigated:**

- Stolen/guessed session cookie without the CSRF secret → blocked on any mutating request.
- Cross-tenant data access via a guessed or manipulated organization id → blocked by
  `MembershipGuard` (relational integrity backstop: composite FKs in the schema itself).
- Password database compromise → Argon2id-hashed, not reversible; timing between "unknown
  account" and "wrong password" is narrowed (not eliminated — see below) by always running a
  real hash verification.
- Brute-force login/registration → Redis-backed rate limiting.
- Session replay after logout → revocation is a database write, checked on every request.
- A member elevating their own role → no code path accepts a role from the client at all
  (enforced by the global `ValidationPipe`'s `forbidNonWhitelisted`, tested explicitly).

**Explicitly out of scope / residual risk:**

- **Timing-based account enumeration via login response latency** is reduced, not eliminated:
  a real Argon2id verification always runs, but network jitter and hardware variance mean a
  sufficiently patient, well-resourced attacker measuring many requests could still extract a
  weak signal. Full elimination would need constant-time response padding, judged
  disproportionate for this project's threat model.
- **XSS**: if an attacker achieves script execution on the frontend origin, they can read the
  non-HttpOnly CSRF cookie and forge requests as the victim (the session cookie itself stays
  HttpOnly and out of reach). This project doesn't implement a Content-Security-Policy or
  output-encoding audit — standard React JSX escaping is the only current mitigation.
  Session-bound CSRF does not protect against XSS; nothing does except not having the XSS.
- **Compromised database backup/dump**: session and CSRF secrets are hashed and unrecoverable,
  but password hashes are still crackable offline at whatever cost Argon2id's configured
  parameters impose — a real, accepted risk of any hashed-password design.
- **No email verification**: a registered email is not confirmed to be reachable by its owner.
- **No account recovery**: a user who forgets their password has no self-service reset path.
- **No organization invitations**: the only way a second user joins an existing organization
  today is a direct database insert (used by this milestone's own tests to construct a
  'staff' membership fixture) — there is no API surface for it yet, which is also why it
  cannot be misused by an attacker.

## Security tests

`apps/api/test/security/*.security-spec.ts` — 32 tests, real Postgres, real Redis, real HTTP
requests via supertest, real cookies. See the commit history for the full breakdown; briefly:
credential handling (hashing, generic errors, no leakage), session lifecycle (creation,
freshness, revocation, both expirations, tampered/malformed/absent cookies, fixation),
CSRF (valid/missing/wrong/forged, untrusted origin, post-rotation invalidation), tenancy
(cross-org rejection, non-member vs. nonexistent org, self-elevation, revocation/promotion
taking immediate effect), bootstrap atomicity (rollback, no cross-org targeting), and
rate limiting (per-route, not global).

`apps/web/e2e/auth.spec.ts` (Playwright, real Chromium, real API) covers the equivalent
browser-level journey: register → dashboard → logout → redirect-to-login → log back in;
generic invalid-credentials message; an owner renaming their organization. Assumes both dev
servers are already running (documented in `playwright.config.ts`) — it does not manage their
lifecycle itself.

## Known limitations

- No organization invitation flow — see Threat model above.
- No account recovery / password reset.
- No email verification.
- Timing-based login enumeration is narrowed, not eliminated (see Threat model).
- No Content-Security-Policy or systematic output-encoding audit on the frontend.
- No automatic session-cleanup job for expired/revoked rows — they persist in the table
  indefinitely (harmless for correctness, a housekeeping gap for storage growth over time).
- Rate limiting is IP-keyed; a NAT'd office or shared IP could see legitimate users throttled
  together. No per-account limiter exists as a complement.
- This has not been independently security-audited. The controls above are what's actually
  implemented and tested, not a certification of production-readiness.
