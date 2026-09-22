# Frontend Architecture

## Status

Implemented as of Milestone 5: a real Next.js App Router dashboard (`apps/web`) covering
registration/login/logout, an operational overview, product management, inventory viewing and
adjustment, order creation, and order fulfillment/cancellation — all against the real NestJS
API from Milestones 1-4, with no mocked business data. This document describes what is
actually implemented and verified, not a target design; see [Known limitations](#known-limitations)
for what's deliberately out of scope or not yet built.

## Route map

| Route                             | Access        | Purpose                                                           |
| --------------------------------- | ------------- | ----------------------------------------------------------------- |
| `/`                               | Public        | Marketing/landing page, links to register/login                   |
| `/login`, `/register`             | Public        | Auth forms (Milestone 2)                                          |
| `/dashboard`                      | Authenticated | Redirects to `/dashboard/overview`                                |
| `/dashboard/overview`             | Authenticated | Operational metrics (see [Dashboard metrics](#dashboard-metrics)) |
| `/dashboard/products`             | Authenticated | Paginated product list                                            |
| `/dashboard/products/new`         | `owner` only  | Product creation form                                             |
| `/dashboard/products/[productId]` | Authenticated | Product + inventory detail                                        |
| `/dashboard/inventory`            | Authenticated | Stock levels; adjustment control is `owner`-only                  |
| `/dashboard/orders`               | Authenticated | Paginated order list                                              |
| `/dashboard/orders/new`           | Authenticated | Multi-line reservation form                                       |
| `/dashboard/orders/[orderId]`     | Authenticated | Order detail; fulfill/cancel controls when `pending`              |
| `/dashboard/settings`             | Authenticated | Organization rename (`owner` only, from Milestone 2)              |

"`owner` only" above means the control is hidden client-side for a `staff` member as a UX
convenience — the actual enforcement is the backend's own `RolesGuard`, verified independently
in Playwright's Flow C (see [Testing](#testing)).

`/`, `/login`, `/register`, and `/forbidden` are unchanged from Milestone 2 — plain Tailwind
utility classes, not shadcn/ui — a deliberate reuse decision (this milestone's brief asked to
adapt existing working pages, not duplicate them) rather than an oversight; they were already
functionally correct and accessible (labeled inputs, `role="alert"` errors). The design-system
work in this milestone is scoped to the authenticated `/dashboard/*` surface, which didn't exist
before. `/forbidden` in particular is currently unreferenced by any link in this milestone's
code — a pre-existing page from Milestone 2, kept as-is rather than removed speculatively.

## Server and Client Component boundaries

Every page under `app/dashboard/` is a Client Component (`'use client'`): each one holds
interactive state (pagination cursors, dialogs, forms) and reads `useOrganization()`/`useAuth()`
context, which cannot run in a Server Component. Two route segments (`products/[productId]`,
`orders/[orderId]`) use a thin, non-`'use client'` `page.tsx` that only `await`s the
Next.js-15+-style `Promise<{ productId: string }>` params object and passes the resolved string
down to a Client Component (`ProductDetailView`, `OrderDetailView`) that does the actual data
fetching and rendering — the split exists solely to satisfy that params-is-a-Promise contract
without making the whole detail view a server component it can't be (it needs client state for
the fulfill/cancel dialogs). No page in this milestone does real server-side data fetching
(`fetch` in a Server Component, Next.js's request-memoized cache, or `generateStaticParams`):
every data fetch is a `useEffect` + the typed API client, deliberately, for two reasons: (1) all
dashboard data is tenant-scoped and must never be cached across users/organizations by Next.js's
own data cache or full-route cache (see [Preventing cross-tenant cache leaks](#preventing-cross-tenant-cache-leaks)),
and (2) this project's Next.js version (16.3.5) does not have `cacheComponents`/PPR enabled
(see `next.config.ts`), so there is no framework-level caching layer to reason about in the
first place — a plain client fetch is the simplest correct option, not a workaround.

## The API client (`lib/api.ts`)

A single typed client, `api`, wrapping every backend endpoint the dashboard calls. It is
intentionally thin:

- `credentials: 'include'` on every request, so the `HttpOnly` session cookie
  (`fulfillos.sid` — see [authentication.md](authentication.md#cookie-configuration)) is sent
  automatically; the client never reads or stores it.
- The CSRF token is read from its own non-`HttpOnly` cookie (`fulfillos.csrf`) at request time
  and attached as `X-CSRF-Token` on every mutating request — read fresh each time, not cached in
  component state, so a rotated token (`GET /auth/csrf`) is always picked up correctly.
- `ApiError` carries the real HTTP status and the backend's own message; callers branch on
  `err.status` (e.g. 409 for a duplicate SKU or a fulfillment conflict) instead of guessing.
- `isSessionExpired(err)` centralizes "was this a 401" so every page handles session expiry the
  same way (see [Session expiration](#session-expiration)) instead of re-implementing it.
- Mutating methods that map to an idempotency-key-guarded backend endpoint (order creation,
  fulfillment, cancellation, inventory adjustment) take the key as an explicit parameter rather
  than generating one internally — see [State management](#state-management).
- A network failure (the `fetch` itself rejecting) is normalized to `ApiError(0, ...)`; an
  aborted request (see below) is re-thrown as its original `DOMException` so callers can
  distinguish "cancelled on purpose" from "the network failed."

## Authentication and CSRF integration

`AuthProvider` (`lib/auth-context.tsx`, mounted once in the root layout) calls `GET /auth/me` on
mount and exposes `{ user, loading }`; nothing about this is a second authentication system —
it is a read of the same session the API already validates on every request. `DashboardLayout`
(`app/dashboard/layout.tsx`) redirects to `/login` once `loading` is false and `user` is null.
This client-side redirect is a UX convenience only: the real security boundary is that every API
request the dashboard makes is independently checked by `SessionAuthGuard`/`MembershipGuard` on
`apps/api`, regardless of what this layout renders (see
[authentication.md](authentication.md#organization-context)). No session token is ever read from
or written to `localStorage` or any client-accessible JavaScript state — the session cookie
stays `HttpOnly` end to end, matching [ADR-004](../adr/0004-csrf-session-bound-synchronizer-token.md).
CSRF handling is entirely inside `lib/api.ts` (above); no page or component reimplements it.

### Session expiration

A 401 from any `api.*` call is normalized by `isSessionExpired()`. Every data-fetching page
checks this in its `.catch()` and calls `router.push('/login')` rather than rendering a generic
error — a user whose session has expired mid-visit lands on the login page instead of a
confusing permission error. This is duplicated per-page (not centralized in the API client
itself) deliberately: redirecting is a routing decision that belongs to the page/router, not to
a plain `fetch` wrapper, and each page already has its own `router` instance from
`next/navigation`.

## Organization switching

`OrganizationProvider` (`lib/organization-context.tsx`) loads the caller's memberships
(`GET /organizations`) and holds `currentOrganizationId`. Switching organizations
(`OrgSwitcher`, a `Select` in the header — rendered only when a user has more than one
membership; a single-organization user sees plain text, not a functionless dropdown) only ever
changes that one piece of context state. The mechanism that actually clears previous-tenant data
is `app/dashboard/layout.tsx`'s `<main key={currentOrganizationId}>{children}</main>`: React
remounts every page under `/dashboard` from scratch when the key changes, which means:

- Every page's own component state (list items, form fields, dialog state) is thrown away and
  re-initialized, not patched — there is no way for a previous organization's product name to
  linger in a re-rendered list.
- Every page's data-fetching `useEffect` runs its cleanup function on unmount, calling
  `controller.abort()` on its in-flight `AbortController` — a request for the old organization
  that resolves after the switch is simply discarded (`AbortError`, explicitly ignored in every
  fetch's `.catch()`), so it can never render over the new organization's UI.
- A product picker on the order-creation form (`/dashboard/orders/new`) that had a previous
  organization's product selected is reset for the same reason — it is a fresh component
  instance, not a form that needs manual clearing logic.

`currentOrganizationId` is never trusted as authorization; every request still carries it only
as a route parameter, and the API's own `MembershipGuard` re-validates membership on every
single request (see [authentication.md](authentication.md#organization-context)). The "last
used organization" convenience (`lib/organization-context.tsx`'s `LAST_ORG_STORAGE_KEY`) is the
only thing this frontend puts in `localStorage`, and it is explicitly documented in that file as
non-sensitive and non-authoritative — losing it (private browsing, cleared storage) only means
falling back to the first membership, never a security or correctness issue.

## Preventing cross-tenant cache leaks

Because there is no server-side data fetching in any dashboard page (see
[Server and Client Component boundaries](#server-and-client-component-boundaries)), there is no
Next.js Data Cache or Full Route Cache entry to accidentally share between users or
organizations — every request is a plain client-side `fetch` issued fresh by a mounted
component, with `cache: undefined` (Next.js's default, uncached, for a `fetch` call outside its
extended caching APaths). The organization-switch remount (above) is what prevents a _component's
own state_ from leaking between organizations within one browser session; there is no
component-level cache (React Query, SWR, or similar) in this project that would need a separate
invalidation story.

## State management

No global state library (Redux, Zustand, etc.) is used — deliberately: the only genuinely
cross-page state is "who is logged in" (`AuthProvider`) and "which organization is selected"
(`OrganizationProvider`), both small enough for plain React context. Every other piece of state
is local to the page or dialog that owns it, fetched fresh on mount.

**Idempotency.** `useIdempotencyKey()` (`lib/idempotency.ts`) generates one key via
`useState(generateKey)` — stable across re-renders and across retries of the same mounted
form/dialog, which is exactly what a retry after a network failure or an ambiguous timeout
needs (reusing the key lets the backend recognize a retried request as the same one, per
[order-lifecycle.md](order-lifecycle.md) and [inventory.md](inventory.md)). `renew()` is called
only at genuinely new logical attempts: order creation gets a new key by virtue of the whole
page remounting on organization switch or navigation; the inventory-adjustment dialog and the
order fulfill/cancel dialogs call `renew()` explicitly at the moment they transition to open (a
new adjustment/transition attempt), never automatically on every retry within one open dialog.

**Derived-state resets without `useEffect`.** Every list/detail page needs to reset its
`loading`/`error` state when its "identity" changes (a different organization, a different
cursor, a different `productId`/`orderId`). Doing this with a synchronous `setState` call inside
a `useEffect` body is flagged by this project's `react-hooks/set-state-in-effect` ESLint rule
(and for good reason: it causes an avoidable extra render pass). Every page instead tracks the
current identity in a `trackedRequestKey` state and compares it during render — React's own
recommended pattern for "reset derived state when an input changes" — synchronously resetting
`loading`/`error` in the same render as the identity change, never inside the effect. The actual
async fetch stays in a separate `useEffect` whose only `setState` calls happen inside
`.then()`/`.catch()`/`.finally()`, which the lint rule does not (and should not) flag.

**Retry vs. reload.** A list/detail page's `useEffect` is keyed only on its actual data
dependencies (organization id, cursor, `productId`/`orderId`) — not on a "please retry" signal —
so a retry button cannot just clear the error and hope the effect re-fires; it has to actually
re-invoke the fetch. Every such page splits its fetch into an inner `fetchX(signal)` (used only
by the `useEffect`, no synchronous resets of its own) and an outer `reload()`/`load()` (resets
`loading`/`error` and calls `fetchX()` again) — `reload()` is what `onRetry` calls, and also what
runs after a successful mutation (an inventory adjustment, an order fulfillment/cancellation)
to refresh authoritative data from the server rather than patching local state from an
optimistic assumption about the new values.

## Dashboard metrics

`/dashboard/overview` renders five counts — total products, pending/fulfilled/cancelled orders,
and low-stock products — from one endpoint, `GET /organizations/:organizationId/dashboard/summary`
(`apps/api/src/dashboard`), added in this milestone specifically so the browser never computes
these by fetching every product and order. Each count is a single `SELECT count(*)`-style
aggregate query (a plain count on `products`, a `GROUP BY status` count on `orders`, and a
`(on_hand - reserved) <= LOW_STOCK_THRESHOLD` count on `inventory`) run in parallel via
`Promise.all`, scoped by `organizationId` — never a client-side sum over a paginated page.
`LOW_STOCK_THRESHOLD = 5` is defined once, in `apps/api/src/dashboard/dashboard.service.ts`, and
the frontend's `AvailabilityBadge` duplicates only the _number_ for its own low-stock badge
styling (documented at its definition as a display concern, not a second definition of the
business rule — the dashboard's actual low-stock count always comes from this endpoint). No
revenue, profit, growth, or sales figures are shown, because no such data exists in this
system yet.

## Accessibility

Manually verified by keyboard, without a mouse, for the primary authenticated workflows:
registering, logging in, switching organizations, creating a product, adjusting inventory,
creating an order, and fulfilling/cancelling an order. Every interactive control reached in
those walkthroughs was operable via Tab/Shift+Tab/Enter/Space/Escape, and focus was visibly
indicated throughout, coming from shadcn/ui's (Base UI's) default focus-ring styling plus this
project's own `@theme` tokens (`app/globals.css`) rather than a browser default.

Concretely, in this codebase:

- Every form input has a real, programmatically associated `<Label htmlFor>` (verified in
  component tests via Testing Library's `getByLabelText`, which fails outright for an
  unassociated label — see [Testing](#testing)).
- Every error message uses `role="alert"` (`ErrorState`, inline field errors, `ConfirmDialog`'s
  error text) so assistive technology announces it without the user needing to find it.
- Dialogs (`ConfirmDialog`, the inventory adjustment dialog, the mobile navigation `Sheet`) are
  Base UI primitives with built-in focus trapping and `Escape`-to-close; this was exercised
  manually, not just assumed from the library.
- Tables use real `<table>`/`<th>`/`<td>` semantics (shadcn's `Table` primitives), not styled
  `<div>` grids.
- The sidebar collapses to a `Sheet` (an accessible off-canvas drawer, not a bare `display:none`
  toggle) below the `lg` breakpoint, reachable via a labeled "Open navigation menu" button.

**Not independently verified**, stated honestly rather than assumed: no automated axe/accessibility
scan is wired into the Playwright suite in this milestone (the milestone brief allows this
where impractical — a dedicated `@axe-core/playwright` integration was judged out of scope
given the time available); no screen-reader software (VoiceOver/NVDA/JAWS) was used to verify
announcement wording end to end, only the `role="alert"`/label-association structure that
assistive technology relies on; color contrast was not measured with a dedicated contrast-ratio
tool, only checked visually against the design tokens' light and dark palettes.

## Responsive design

Every dashboard page uses Tailwind's responsive utilities (`sm:`, `lg:`) rather than a
separate mobile layout: the sidebar is `hidden lg:flex` (replaced by the header's `Sheet` drawer
below `lg`), metric/table grids collapse from multi-column to single-column
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`), and forms stack vertically on narrow viewports.
Manually verified in a real browser at three widths (a phone-width ~390px, a tablet-width
~768px, and a desktop ~1280px viewport) across the overview, products, inventory, and order
pages — no horizontal scrolling or clipped controls observed at any of the three.

## Testing

Two automated layers, plus the manual verification described above:

**Component tests** (Vitest + React Testing Library, `apps/web/**/*.test.{ts,tsx}`, run via
`pnpm --filter @fulfillos/web test`) — isolated, with the API client and `next/navigation`
mocked at the module boundary, covering: the idempotency-key hook's stability across
re-renders and explicit `renew()`; pagination controls' disabled/enabled states and click
handlers; the confirmation dialog's await-before-close behavior, error display, and
double-submission prevention; the organization switcher's single-vs-multi-membership rendering
and `switchOrganization` call; the product-creation form's client-side validation, successful
submission, duplicate-SKU (409) field error, and network-failure error, all without ever
navigating away before the mocked API call resolves; and the inventory-adjustment dialog's
immediate-submit-on-increase vs. confirm-before-decrease behavior and idempotency-key reuse
across a simulated failed-then-retried submission.

**Browser tests** (Playwright, `apps/web/e2e/`, run via `pnpm --filter @fulfillos/web test:e2e`)
— real Chromium, against a real running instance of both apps (Playwright's own `webServer`
config starts `apps/api` and `apps/web`, waiting for each to be ready) and a real, isolated
Postgres database (the same distinct-role `fulfillos_test` database and role the Jest
integration/security suites use, resolved via the shared
`apps/api/scripts/lib/test-database-url.ts` helper — never the development database).
`e2e/global-setup.ts` runs the existing migration script once before the suite starts; it
deliberately does not truncate the database, since every test generates unique
emails/SKUs/organization names (`e2e/helpers.ts`'s `unique()`), so leftover data from a previous
run cannot collide with a fresh one. No test relies on an arbitrary `sleep`; every wait is on a
real Playwright locator or a real navigation.

Specs, one file per flow from the milestone brief:

- `auth.spec.ts` — register → dashboard → logout → redirected to login → log back in; a generic
  invalid-credentials message; an owner renaming their organization (Milestone 2 flow, retained).
- `product-fulfillment.spec.ts` (Flow A) — register, create a product with initial stock, create
  an order reserving part of that stock, fulfill it, and verify both the order's status and the
  resulting on-hand/available inventory.
- `cancellation.spec.ts` (Flow B) — create an order, reserve stock, cancel it, and verify the
  reserved quantity is released back to available exactly once.
- `permissions.spec.ts` (Flow C) — a `staff` member cannot create a product or see the inventory
  adjustment control; critically, the product-creation case navigates directly to
  `/dashboard/products/new` (a route the UI itself never links to for `staff`) and submits the
  form anyway, asserting the backend's own 403 — not merely that a button is hidden.
- `tenant-isolation.spec.ts` (Flow D) — a user with memberships in two organizations with
  distinct products sees only the selected organization's data after switching, in both
  directions, and a product picker referencing the previous organization is cleared on switch.
- `failure-handling.spec.ts` (Flow E) — insufficient-stock rejection on order creation, invalid
  product-creation input, a duplicate-SKU conflict, an already-expired session redirecting to
  login instead of silently failing, and a rapid double-click on order submission producing
  exactly one order.
- `order-conflict.spec.ts` (Milestone 6) — two tabs sharing one authenticated session both load
  the same pending order; one tab fulfills it and genuinely succeeds; the other tab, still
  showing its stale "pending" view, then attempts to cancel the same order and receives a real
  409 from the backend. Proves: exactly one transition wins, the loser gets a real conflict
  message (never a false success), the loser's UI refreshes to the authoritative `Fulfilled`
  state with both transition controls gone, and inventory reflects only the winning transition.
  This is deliberately **not** an attempt at a byte-for-byte simultaneous race — reliably forcing
  two real browser requests into the same sub-millisecond Postgres lock window isn't achievable
  without either an arbitrary sleep or a test-only synchronization hook in production code. That
  guarantee — two truly concurrent `fulfillOrder`/`releaseReservation` calls against real
  Postgres resolving to exactly one winner via row-level locking — is what
  `apps/api/test/integration/order-cancellation-race.integration-spec.ts` already proves, with a
  literal `Promise.allSettled` race against a real database. The two tests are complementary,
  not duplicates: one proves the database-level concurrency guarantee under genuine simultaneity,
  the other proves the frontend's conflict-handling code path behaves correctly when a client's
  view goes stale — which is the shape every real "two tabs" or "two staff members" scenario
  actually takes.

Flows D and part of C use a direct-database helper (`e2e/db.ts`) to add a second organization
membership and to force-expire a session — both stand in for an invitation flow and a real idle
timeout that this milestone doesn't implement/doesn't want to wait out in a test; see
[Known limitations](#known-limitations).

**Results**: see the Milestone 6 checkpoint report for the actual pass/fail counts from the run
executed for that milestone, since this document is meant to stay accurate rather than being
re-edited with every future test run.

## Error handling

Every mutating action follows the same shape: disable the triggering control while the request
is in flight (`submitting`/`isSubmitting` state), never claim success before the server confirms
it (no optimistic navigation or optimistic state update anywhere in this milestone's code), and
render the server's own error message (via `ApiError.message`) rather than a generic string,
falling back to a generic message only for a true network failure (`ApiError` with `status: 0`).
A 409 from order fulfillment/cancellation — meaning another actor already moved the order to a
different terminal state — is shown as a distinct "this order changed" banner and immediately
triggers a `reload()` of the authoritative order, rather than being folded into the generic
error path or silently retried.

## Known limitations

- **No organization invitation flow.** The only way a second user joins an existing
  organization is a direct database insert (`e2e/db.ts`'s `addStaffMembership`, used only by
  this milestone's own Playwright fixtures) — there is no UI or API surface for it, matching
  [authentication.md's known limitations](authentication.md#known-limitations).
- **The order-creation product picker is not paginated.** It fetches up to 100 products once
  (`PRODUCT_PICKER_LIMIT` in `app/dashboard/orders/new/page.tsx`) rather than a searchable,
  paginated combobox; a catalog larger than that would need one, which is out of scope for this
  milestone.
- **No automated accessibility scanning** (e.g. axe) is wired into Playwright yet — see
  [Accessibility](#accessibility) for exactly what was and wasn't verified instead.
- **No Content-Security-Policy or systematic output-encoding audit** on this frontend, matching
  the equivalent limitation already documented in
  [authentication.md](authentication.md#known-limitations).
- **No product edit, archive, or delete UI** — the backend doesn't expose those endpoints yet
  (see [order-lifecycle.md](order-lifecycle.md)), so none is implemented here; adding one would
  mean building a control for an API that doesn't exist.
- **No offline/optimistic UI** anywhere — every action waits for a real server response, which
  is a deliberate correctness choice (see [Error handling](#error-handling)), not an oversight,
  but it does mean a slow network is felt directly as UI latency with no local masking.
- **Rate limiting is shared with the development environment** in local, non-CI runs of the
  Playwright suite: the `webServer`-launched API instance points its `REDIS_URL` at the same
  Redis the developer's own `pnpm dev:api` might be using (only `DATABASE_URL` is swapped to
  the isolated test database). Running the Playwright suite repeatedly in quick succession can
  exhaust the registration/login rate limiter shared with manual local testing; this is the
  rate limiter working as designed (see [authentication.md](authentication.md#rate-limiting-and-failure-handling)),
  not a bug, and is not an issue in CI, where no other process shares that Redis instance.
