# ADR-004: CSRF via Session-Bound Synchronizer Token (supersedes part of ADR-003)

## Status

Accepted. Supersedes the CSRF mechanism described in
[ADR-003](0003-multi-tenant-authorization.md), which said "double-submit pattern" without
specifying which variant. This ADR replaces that detail; ADR-003's other decisions (server-side
sessions, never trusting a client-supplied organization id, role-based permissions) are
unchanged and remain in force.

## Context

Sessions are database-backed (ADR-003), not stateless — the server already holds a row per
active session it can attach data to. Naive double-submit cookie CSRF protection (client sends
the same value in a cookie and in a header/body field; server checks the two match) does not
require the server to remember anything about the value, which is exactly its weakness: an
attacker who can set _any_ cookie on the victim's origin (e.g. via a related subdomain, a
misconfigured CORS proxy, or another injection vector unrelated to the session itself) can
mint a matching cookie/header pair without ever seeing the real session. Because a database
row per session already exists here, that weakness is avoidable at no extra infrastructure
cost.

## Decision

Use a session-bound synchronizer token:

- At session creation (login), the server generates a second cryptographically random value
  (the CSRF secret) independent of the session token, and stores a hash of it on the same
  `sessions` row.
- The raw CSRF secret is returned to the client once, in the JSON response body of
  login/register (and re-fetchable via `GET /auth/csrf` while the session is valid) — never
  written into the `HttpOnly` session cookie, and never derivable by an attacker from the
  session cookie alone.
- The client (Next.js) holds this value in memory / a non-`HttpOnly` cookie and sends it back
  on every mutating request via the `X-CSRF-Token` header.
- The server validates that header value against the hash stored on the _authenticated
  request's own session row_ (not merely "does some cookie match some header"), using a
  timing-safe comparison.

This means a valid CSRF token proves the request came from a client that was actually handed
that specific session's secret — not just that two client-controlled values happen to match
each other.

## Alternatives considered

- **Naive double-submit cookie** (compare a CSRF cookie to a header/body value, no server-side
  state): rejected for the reason in Context — it provides no protection against an attacker
  who can plant cookies through some means other than reading the session.
- **Signed double-submit cookie** (server HMACs the token so the client can't forge it without
  the server's key, but the server still doesn't persist it): a reasonable alternative that
  would also work here. Not chosen because sessions are already persisted rows — storing the
  CSRF secret alongside the session is no more complex than signing/verifying an HMAC, and it
  additionally lets a session's CSRF secret be invalidated by revoking the session, with no
  separate key-rotation story to design.

## Consequences

- CSRF validation requires the request's session to already be resolved (the CSRF guard runs
  after session authentication), which is already true for every route this protects.
- Logging out or otherwise revoking a session automatically invalidates its CSRF secret too —
  one revocation path, not two.
- The client must actively read and forward the token; this is implemented once in a shared
  Next.js fetch wrapper (see
  [docs/architecture/authentication.md](authentication.md)), not duplicated per call site.
- This protects mutating, cookie-authenticated requests. It does not and cannot protect
  unauthenticated requests that don't yet have a session (registration, login themselves) —
  those rely on other controls (rate limiting, CORS, generic error responses) described in
  `authentication.md`.
