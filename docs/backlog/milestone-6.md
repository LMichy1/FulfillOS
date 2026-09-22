# Milestone 6 — Final Engineering & Release Readiness (local backlog)

Local, offline backlog — GitHub authentication is unavailable in this environment. These are
**not** GitHub Issues; no issue numbers are implied or referenced in commit messages or code.

Work is classified P0 (release blocker), P1 (important improvement), P2 (optional future work).
P0s were resolved first, before anything else in this milestone.

Status values used below: `not started`, `in progress`, `done`.

---

## Commit-count reconciliation (Milestone 5 checkpoint)

The Milestone 5 checkpoint report said "11 new commits on top of Milestone 4's `8637282`" but
listed exactly 10 commit hashes (`74859d6` through `969e11b`). Reconciled via
`git log --oneline 8637282..969e11b`: there are actually **13** commits between the Milestone 4
and Milestone 5 HEADs — the 10 listed (made in the session that produced the checkpoint) plus
3 made in an earlier session before that checkpoint (`9fe9285` docs backlog, `ed178d1` dashboard
endpoint, `246f825` design-system foundation). "11" was simply an arithmetic slip in the
checkpoint's prose (it should have said 10 for that session's own commits, or 13 counting from
Milestone 4). No commits are missing, no history was rewritten, and no branch or ref is
inconsistent — this was a report-writing error, not a git anomaly.

---

## P0 — Release blockers

### P0-01: Browser-level test for conflicting order transitions (Milestone 5 gap)

**Problem**: Milestone 5's checkpoint identified that no browser-level test covered two clients
racing a fulfill vs. cancel transition on the same order — only a real-Postgres integration
test existed (`order-cancellation-race.integration-spec.ts`).

**Resolution**: Added `apps/web/e2e/order-conflict.spec.ts`. It deliberately does **not** try to
reproduce a true simultaneous race in the browser (network/event-loop timing can't be
orchestrated deterministically without either an arbitrary sleep or a test-only synchronization
hook in production code, both of which the milestone brief rules out) — it proves the concrete,
realistic scenario a browser actually produces: a second tab, already showing the order as
pending, attempts a transition after the first tab's transition has already completed. It
verifies: exactly one transition succeeds, the losing client gets a real 409 conflict message
(not a generic error), no false "Cancelled" success ever appears on the losing client, the
losing client's UI refreshes to the authoritative `Fulfilled` state and both transition controls
disappear, and inventory reflects only the one transition that actually won. The existing
integration test is unchanged and still owns the "genuinely simultaneous, real Postgres lock"
guarantee — see [docs/architecture/frontend.md#testing](../architecture/frontend.md#testing) for
how the two tests' scopes are distinguished in writing, not just in comments.

**Completion status**: done. 1 new Playwright test, passing.

### P0-02: Stale confirmation dialog could reopen on a terminal order after a conflict

**Problem**, found _by_ writing P0-01's test (not before): `OrderDetailView` rendered its
`ConfirmDialog`s unconditionally, gated only by `fulfillOpen`/`cancelOpen` state. When a
transition attempt failed with a 409, the component's own `load()` call (in a `finally` block)
set `loading=true`, which fully unmounts the page (including the open dialog) behind a skeleton,
then remounts once the reload finishes — but `cancelOpen`/`fulfillOpen` were never reset to
`false` on that path, so the dialog reappeared open, offering "Cancel order" on an order that
had just become `Fulfilled`. Clicking it again would only produce the same 409 — not a false
success, but a confusing, genuinely broken control offering an action the backend can never
allow to succeed.

**Resolution**: `apps/web/app/dashboard/orders/[orderId]/order-detail-view.tsx` now renders both
`ConfirmDialog`s only while `order.status === 'pending'`, matching the same guard the trigger
buttons already used. Verified by the new P0-01 test, which explicitly asserts neither a
"Fulfill order" nor a "Cancel order" control remains after the conflict.

**Completion status**: done.

---

## P1 — Important improvements

### P1-01: `CreateReservationDto.currency` missing `@IsString()`

Found during the security release audit: `apps/api/src/reservations/dto/create-reservation.dto.ts`
had `@IsOptional() @Length(3, 3) currency?: string` with no `@IsString()`. `class-validator`'s
`@Length` is lenient about the underlying type, so a non-string `currency` could reach the
service/DB layer, where a `char(3)` column would reject it — a confusing 500 in the worst case,
never a security bypass (no code path trusts `currency` for anything but a fixed-width column
write), but inconsistent with every other DTO in this codebase, which types every field
explicitly. **Resolution**: added `@IsString()`. Backend integration tests re-run clean
afterward (94/94).

**Completion status**: done.

### P1-02: `trust proxy` caution for any future reverse-proxy deployment

Not a current defect — confirmed via the security audit that Express's `trust proxy` setting is
not enabled anywhere in `apps/api/src`, so `request.ip` (used both by `RateLimitGuard`'s Redis
key and, indirectly, cookie `Secure` detection via `NODE_ENV`) cannot currently be spoofed via
`X-Forwarded-For`. This becomes a real risk **only** if a future production deployment sits
behind a reverse proxy and enables `trust proxy` without also configuring it to trust only that
proxy's own address. Documented in
[docs/architecture/authentication.md](../architecture/authentication.md#rate-limiting-and-failure-handling)
and the deployment section of the README as a pre-launch checklist item for whoever configures
that proxy, rather than "fixed" now (there is nothing to fix in code without a real proxy in
front of it to configure against).

**Completion status**: done (documented).

### P1-03: Dependency vulnerability audit (`pnpm audit`)

32 advisories reported (5 low, 14 moderate, 13 high). Reviewed for actual reachability rather
than treating the count at face value:

- **Multer** (8 advisories, high/moderate, all about malicious file-upload handling): confirmed
  unreachable — grepped the entire API source for `FileInterceptor`/`multer`/`@UploadedFile`;
  none exist. FulfillOS has no file-upload endpoint. No fix applied; nothing to fix.
- **`@nestjs/core` — CVE-2026-35515** (moderate, CVSS 6.3, SSE header-injection in
  `SseStream._transform()`): confirmed unreachable — the vulnerability requires a
  `@Sse()`-decorated endpoint that maps user-controlled data into an SSE message's `type`/`id`
  fields; grepped for `@Sse`/`EventSource`/`SseStream` in `apps/api/src` — none exist. The only
  fix is `@nestjs/core@11.1.18+`; the `10.x` line ended at `10.4.22` with no patched backport.
  Upgrading to Nest 11 is a major-version migration, explicitly out of scope for this milestone
  ("avoid unnecessary major dependency upgrades") given it's unreachable and the deadline.
  Documented here as an accepted, tracked risk — re-evaluate whenever a Nest 11 migration is
  independently justified.
- **webpack / ts-loader / fork-ts-checker-webpack-plugin / glob / tmp / js-yaml / lodash / ajv /
  qs / picomatch / file-type / esbuild** (the remainder): all resolve to `@nestjs/cli`'s or
  other dev/build-tool dependency trees (webpack's dev bundler, ESLint's config loader, Jest's
  transitive deps) — none of these packages are present in the runtime dependency graph of the
  deployed API or the Next.js production build; they only execute on a developer's or CI's own
  machine during `build`/`lint`/`test`, never inside a request handled by a real deployed
  instance. No production attack surface. No fix applied.
- No safe (non-major) update closes any of the above; none is reachable in the running
  application. Nothing was upgraded.

**Completion status**: done (audited; no action required beyond what's documented above).

---

## P2 — Optional future work (not addressed this milestone; already-known limitations)

Carried forward from prior milestones' own "Known limitations" sections (see
[README.md](../../README.md#known-limitations),
[authentication.md](../architecture/authentication.md#known-limitations), and
[frontend.md](../architecture/frontend.md#known-limitations)) — repeated here only as a single
consolidated release-notes list, not re-investigated as new work:

- No Content-Security-Policy or systematic output-encoding audit.
- No automated accessibility (axe) scanning in Playwright.
- No `idempotency_keys` cleanup job (expired-but-unclaimed rows persist harmlessly).
- No automatic retry on Postgres serialization failures (`40001`/`40P01`) — not currently needed
  given the deterministic lock ordering, but would matter under much higher write concurrency.
- No per-account rate-limiting complement to the existing per-IP limiter.
- No organization invitation flow, account recovery, or email verification.
- No product edit/archive/delete UI (matching the backend, which doesn't expose those endpoints).
- Order-creation product picker is not paginated (100-item fetch).

None of these block a v1.0.0 release; all are documented, not silently assumed away.
