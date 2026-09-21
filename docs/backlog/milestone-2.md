# Milestone 2 — Authentication, Sessions & Multi-Tenant Authorization (local backlog)

Local, offline backlog — GitHub authentication is unavailable in this environment. These are
**not** GitHub Issues; no issue numbers are implied or referenced in commit messages or code.

Status values used below: `not started`, `in progress`, `done`.

---

## M2-01: Session schema and persistence

**Problem statement**
Database-backed sessions need a table and a service layer to create, validate, touch, and
revoke them, per [ADR-003](../adr/0003-multi-tenant-authorization.md).

**Scope**
Drizzle schema + migration for `sessions`. Session token generation/hashing, idle/absolute
expiration, revocation. No HTTP endpoints yet.

**Acceptance criteria**

- Session tokens are >=256 bits of cryptographically random entropy; only a hash of the token
  is persisted, never the raw value.
- Schema records user association, creation time, last-activity time, idle/absolute
  expiration, revocation, and a CSRF secret bound to the session.
- Indexed lookup by token hash.
- Migration is additive; the Milestone 1 migration is not edited.

**Dependencies**: Milestone 1 (`users` table).

**Tests**: integration tests for session creation, expiration, and revocation lookups.

**Completion status**: not started

---

## M2-02: Registration and secure credential handling

**Problem statement**
The system needs a safe way to create a user and their initial organization, without letting
a client dictate roles or join arbitrary existing organizations.

**Scope**
Argon2id password hashing, registration endpoint that creates a user + a new organization +
an owner membership in a single transaction. No login/session issuance yet (that's M2-03).

**Acceptance criteria**

- Argon2id via a vetted library, explicit parameters meeting current OWASP guidance.
- Duplicate email is rejected safely (using the existing normalized-email uniqueness from
  Milestone 1 — no new normalization policy).
- Registration cannot create a membership in an existing organization the caller doesn't
  already belong to; the client cannot choose its own role.
- Transaction rollback verified if any step fails partway.
- Password hashes never appear in any API response.

**Dependencies**: Milestone 1 (`users`, `organizations`, `memberships`).

**Tests**: successful registration, duplicate email, transaction-rollback-on-failure,
bootstrap cannot target an unrelated existing organization.

**Completion status**: not started

---

## M2-03: Login, logout, and session lifecycle

**Problem statement**
Users need to authenticate with credentials and receive a session; that session must be
revocable and must expire.

**Scope**
Login endpoint (verifies credentials, issues a fresh session — never reusing a
pre-authentication identifier), logout endpoint (revokes the session, clears the cookie),
a session-validation guard used by protected routes, and a `GET /auth/me` endpoint.

**Acceptance criteria**

- Generic "invalid credentials" response for both unknown accounts and wrong passwords (no
  user enumeration).
- Login issues a brand-new session token distinct from anything issued pre-authentication.
- Logout revokes the persisted session; a subsequent request with the old cookie is rejected.
- Expired or revoked sessions are rejected server-side even if the browser still presents the
  cookie.
- Cookie is `HttpOnly`, environment-appropriate `Secure`/`SameSite`, scoped path, no
  unnecessary `Domain`.

**Dependencies**: M2-01, M2-02.

**Tests**: login success/failure, session issuance, `/auth/me`, logout revocation, expired
session rejection, tampered/invalid cookie rejection, session-fixation check (pre-auth session
id, if any, is not the one that becomes authenticated).

**Completion status**: not started

---

## M2-04: CSRF and HTTP security

**Problem statement**
Cookie-authenticated mutating requests need CSRF protection beyond `SameSite` alone.

**Scope**
Session-bound synchronizer-style CSRF token (see
[ADR-004](../adr/0004-csrf-session-bound-synchronizer-token.md) — supersedes the double-submit
detail in ADR-003), a guard enforcing it on mutating routes, and narrowly-scoped CORS.

**Acceptance criteria**

- CSRF secret is generated per-session, stored server-side (hashed), never derivable from the
  session cookie alone.
- Client obtains the raw token via API response (not by reading the httpOnly session cookie),
  and sends it back via a request header on mutating requests.
- Timing-safe comparison for validation.
- Missing/incorrect/forged tokens rejected; GET requests never perform mutations.
- CORS: explicit trusted origin (`WEB_ORIGIN`), `credentials: true`, never combined with a
  wildcard origin.

**Dependencies**: M2-01, M2-03.

**Tests**: valid request, missing token, wrong token, forged cross-site request, untrusted
origin, token invalid after session replacement (login again / logout+login).

**Completion status**: not started

---

## M2-05: Organization authorization

**Problem statement**
Protected, organization-scoped endpoints need server-side enforcement that the caller is an
active member with a sufficient role — never inferred from a client-supplied organization id.

**Scope**
Membership/role guard, `@Roles()` decorator, permission matrix, `GET /organizations` (list
caller's memberships), `GET /organizations/:id` (protected org context, membership-checked).

**Acceptance criteria**

- A request must independently establish: valid session → active user → target org exists →
  caller has an active membership in it → role permits the action.
- Client-supplied organization id is never trusted as proof of membership.
- Deny-by-default; a non-member gets 403/404 (not resource details), an unauthenticated
  caller gets 401.
- Role cannot be self-elevated by a member.

**Dependencies**: M2-01, M2-03, Milestone 1 (`memberships`, `organizations`).

**Tests**: cross-tenant read/write rejected, non-member rejected, self-role-elevation
rejected, revoked membership takes effect immediately (no stale authorization in a long-lived
session).

**Completion status**: not started

---

## M2-06: Next.js authentication vertical slice

**Problem statement**
The frontend needs real screens exercising the actual NestJS auth API — no mock
authentication.

**Scope**
Registration, login, authenticated dashboard shell, organization selector (when >1
membership), unauthorized/forbidden state, logout. Uses `fetch` against the real API with
`credentials: 'include'` and the CSRF header.

**Acceptance criteria**

- No authentication logic duplicated in Next.js — it calls the NestJS API for every
  auth-relevant decision.
- Handles invalid credentials, validation errors, expired sessions, server failures, loading
  states.
- No session token in `localStorage` or otherwise exposed to page JS.

**Dependencies**: M2-01 through M2-05.

**Tests**: manual verification at minimum; Playwright where practical (see M2-07).

**Completion status**: not started

---

## M2-07: Security integration tests and documentation

**Problem statement**
The security properties above are only real if tested against a real database and real HTTP
requests, and only trustworthy if documented accurately.

**Scope**
Full integration/HTTP test suite (credentials, sessions, CSRF, tenancy, bootstrap — see the
milestone brief's test list), `docs/architecture/authentication.md`, README updates, ADR-004.

**Acceptance criteria**

- All required test categories from the milestone brief pass against real Postgres, real
  cookies, real HTTP requests (supertest) — not mocked.
- Documentation matches what's actually implemented, including a threat model and known
  limitations (e.g. no account recovery, no invitations, in scope-deferral).

**Dependencies**: all of the above.

**Tests**: this item _is_ the test suite.

**Completion status**: not started
