# Milestone 5 — Enterprise Dashboard & Full-Stack Integration (local backlog)

Local, offline backlog — GitHub authentication is unavailable in this environment. These are
**not** GitHub Issues; no issue numbers are implied or referenced in commit messages or code.

Status values used below: `not started`, `in progress`, `done`.

---

## M5-01: Frontend architecture and design system

**Problem statement**
The frontend (Milestone 2) is a minimal, unstyled auth vertical slice — no shared layout, no
component library, no design tokens. A dashboard with products/inventory/orders needs a
consistent shell (sidebar, header, page header) and reusable primitives (table, badge, dialog,
form, empty/error/loading states) before any feature page can be built on top of it.

**Scope**
Install and configure shadcn/ui on the existing Tailwind v4 setup; establish design tokens
(spacing, typography, color); build the dashboard shell (`app/dashboard/layout.tsx`: sidebar +
header) and the shared primitives feature pages will reuse.

**Acceptance criteria**

- One consistent visual language (spacing, type scale, color, focus ring) across every new page.
- Sidebar and header are keyboard-navigable with visible focus states.
- Responsive at desktop, tablet, and mobile widths (sidebar collapses to a sheet/drawer on
  small screens).
- No component is added speculatively — each one is used by at least one real page in this
  milestone.

**Dependencies**: none (foundation for every other M5 item).

**Tests**: component tests for the shared primitives that carry real behavior (data table
pagination controls, confirm dialog, status badge variants).

**Completion status**: not started

---

## M5-02: Secure API client and session integration

**Problem statement**
`lib/api.ts` only covers auth/organizations (Milestone 2). It needs typed methods for the
Milestone 3/4 product, inventory, order, reservation, and fulfillment endpoints, plus explicit
handling for session expiration, tenant-scoped requests, and safe cancellation — without
introducing a second authentication or authorization system in Next.js.

**Scope**
Extend `lib/api.ts` with typed methods for every backend endpoint the dashboard needs; add an
`OrganizationProvider` (current organization id + role, never trusted as authorization by
itself — every request is still authorized server-side); add an idempotency-key helper
(`lib/idempotency.ts`) for the two mutating flows that require one (order creation, order
fulfillment/cancellation, inventory adjustment).

**Acceptance criteria**

- Every mutating request still sends the CSRF header exactly as the existing client already
  does — no security control is loosened to make new endpoints easier to call.
- No session token or CSRF secret is ever stored in `localStorage`; the CSRF cookie remains the
  only client-readable copy, matching ADR-004.
- A 401 from any API call is treated uniformly (session state cleared, redirect to `/login`) —
  not re-implemented per page.
- Switching organizations cancels in-flight requests for the previous organization (via
  `AbortController`) so a late response can never render stale-tenant data over the new
  organization's UI.

**Dependencies**: none.

**Tests**: unit tests for the API client's error normalization, the idempotency-key helper's
key stability across retries, and the organization-switch request-cancellation behavior.

**Completion status**: not started

---

## M5-03: Dashboard and operational metrics

**Problem statement**
There is no operational overview — an owner or staff member has no single place to see how
their organization's catalog and order pipeline are doing. Computing this in the browser by
fetching every product and order would defeat pagination and risk N+1 queries.

**Scope**
One minimal, tenant-scoped, database-aggregated metrics endpoint
(`GET /organizations/:organizationId/dashboard/summary`) on the existing NestJS API, and the
`/dashboard/overview` page that renders it: total products, pending/fulfilled/cancelled order
counts, and low-stock product count (defined explicitly — see the endpoint's doc comment).

**Acceptance criteria**

- Every number comes from a `SELECT count(*)`-style aggregate query against PostgreSQL, never
  from summing a paginated page fetched into the browser.
- Low-stock threshold is defined in one place and documented, not a magic number scattered
  across the UI.
- No revenue, profit, growth, or sales figures are shown — none of that data exists yet.
- Loading, empty (a brand-new organization with no products/orders), and error states are all
  implemented and distinguishable.

**Dependencies**: M5-01, M5-02.

**Tests**: an integration test for the new aggregate endpoint (real Postgres, asserting counts
against known fixture data) and a component test for the three UI states.

**Completion status**: not started

---

## M5-04: Product management interface

**Problem statement**
There is no UI for the catalog API (Milestone 4): no way to list, create, or inspect products
without calling the API directly.

**Scope**
`/dashboard/products` (paginated list), `/dashboard/products/new` (creation form, owner-only),
`/dashboard/products/[productId]` (detail, including live inventory).

**Acceptance criteria**

- Creation calls the real `POST /products` endpoint; the initial-stock field maps to the same
  atomic product+inventory creation Milestone 4 already built — no separate "create then
  adjust" round trip.
- Duplicate SKU, invalid input, and permission errors are all shown clearly, sourced from the
  API's actual response, not guessed client-side.
- Pagination uses the API's real cursor, not a client-side slice of a single fetched page.
- No edit or delete control is shown — neither endpoint exists on the backend yet.

**Dependencies**: M5-01, M5-02.

**Tests**: component tests for the creation form's validation and error states; a Playwright
flow covering creation end to end.

**Completion status**: not started

---

## M5-05: Inventory management interface

**Problem statement**
There is no UI for viewing or adjusting inventory (Milestone 3's `InventoryController`).

**Scope**
`/dashboard/inventory`: on-hand/reserved/available per product, and an adjustment action
(reusing `POST /inventory/adjustments`, owner-only, backend-enforced).

**Acceptance criteria**

- `reserved` is displayed but never directly editable from this page — only `on_hand` deltas
  are submitted, through the existing endpoint.
- Every adjustment submission carries a fresh, stable idempotency key generated once per
  logical submission attempt (not regenerated on a retry of the same attempt).
- A confirmation step is required before submitting a stock **decrease** (a consequential,
  hard-to-reverse action from the UI's perspective) but not before an increase.
- After a successful adjustment, the page re-fetches authoritative inventory from the API — the
  displayed row is never derived purely from the optimistic form input.
- The adjustment control is hidden for a `staff` member (owner-only, per the backend's own
  role check) — hiding it is a UX convenience; the backend rejection is what's actually tested.

**Dependencies**: M5-01, M5-02.

**Tests**: component tests for the adjustment dialog (idempotency key stability across a
simulated retry, confirmation gate on decreases); a Playwright flow verifying a staff account
still gets a real 403 if it somehow submits the request.

**Completion status**: not started

---

## M5-06: Order creation interface

**Problem statement**
There is no UI for the reservation engine (Milestone 3): no way to build a multi-product order
and submit it as a reservation without calling the API directly.

**Scope**
`/dashboard/orders/new`: add/remove product lines, quantities, review, submit. Uses
`POST /reservations` with one stable idempotency key per submission attempt.

**Acceptance criteria**

- Duplicate product lines are rejected client-side with the same rule the backend enforces
  (one line per product), so a doomed request is never sent.
- The idempotency key is generated once when the form is first ready to submit and reused for
  every retry of that same logical submission (including a retry after a network failure or an
  ambiguous timeout) — a brand new key is only generated for a genuinely new order attempt
  (e.g., the user navigates away and starts over).
- Insufficient stock, validation errors, permission errors, and idempotency conflicts each
  render a distinct, accurate message sourced from the API response.
- Success (redirect to the new order's detail page) is shown only after the API confirms the
  reservation was created — never optimistically before the response arrives.

**Dependencies**: M5-01, M5-02, M5-04 (needs the product list to select from).

**Tests**: component tests for line add/remove/duplicate-rejection and the idempotency-key
retention behavior; a Playwright flow covering successful creation and an insufficient-stock
rejection.

**Completion status**: not started

---

## M5-07: Order management and fulfillment

**Problem statement**
There is no UI for listing orders, viewing their detail, or driving the
`pending -> fulfilled` / `pending -> cancelled` transitions Milestones 3 and 4 built.

**Scope**
`/dashboard/orders` (paginated list) and `/dashboard/orders/[orderId]` (detail: items, status,
fulfill/cancel actions). Reuses the existing fulfill/cancel endpoints with idempotency keys.

**Acceptance criteria**

- Fulfill/cancel controls are shown only for a `pending` order — never for one already
  `fulfilled` or `cancelled`, matching the backend's own terminal-state enforcement.
- A confirmation dialog is required before either transition (both are consequential and
  irreversible from the UI's perspective).
- After a successful transition, both the order and (where visible on the same page) inventory
  data are re-fetched from the API — never patched purely from client-side assumptions about
  the new state.
- If a transition is rejected because another actor already moved the order to a different
  terminal state (a real concurrent-update conflict, not a hypothetical), the UI shows that
  conflict plainly and reloads the authoritative order — it does not silently retry or hide the
  conflict.

**Dependencies**: M5-01, M5-02, M5-06.

**Tests**: component tests for the transition controls' visibility rules and the confirmation
dialogs; Playwright flows for fulfillment and cancellation, including the conflict case
(fulfilling an order concurrently cancelled by another simulated actor).

**Completion status**: not started

---

## M5-08: Accessibility and responsive design

**Problem statement**
An enterprise dashboard needs to be usable by keyboard and screen-reader users, not just
visually complete — this is not automatically true just because shadcn/ui components are used.

**Scope**
A pass over every new page and shared component: semantic landmarks, labeled form fields,
keyboard-operable navigation and dialogs, visible focus, accessible tables, and responsive
layouts at desktop/tablet/mobile widths.

**Acceptance criteria**

- Every interactive control is reachable and operable by keyboard alone (verified manually and
  noted per page — see [docs/architecture/frontend.md](../architecture/frontend.md#accessibility)
  for exactly what was and wasn't automated).
- Every form input has a programmatically associated label.
- Focus is visible on every interactive element in both the light and dark color schemes.
- Any accessibility requirement not independently verified is documented as such, not silently
  assumed to be fine because a library was used.

**Dependencies**: M5-01 through M5-07 (applies across all of them).

**Tests**: automated accessibility checks (axe) integrated into the Playwright suite for the
primary authenticated pages, where practical.

**Completion status**: not started

---

## M5-09: Browser testing and CI

**Problem statement**
The only existing Playwright coverage is the Milestone 2 auth flow. The dashboard, catalog,
inventory, and order workflows this milestone adds have no end-to-end coverage, and CI does not
run Playwright at all yet.

**Scope**
Expand `apps/web/e2e/` to cover the flows in the milestone brief (product+fulfillment,
cancellation, permissions, tenant isolation, failure handling); update
`.github/workflows/ci.yml` to install browsers, provision an isolated test database, start both
servers, and run Playwright with failure artifacts.

**Acceptance criteria**

- Every new Playwright test exercises the real API and real Postgres — no mocked backend in
  these tests (component-level mocking is for the Vitest/component-test layer, not here).
- Playwright's own test database is provisioned the same isolated way the backend's is (never
  the development database).
- No test relies on an arbitrary `sleep`; waits are on real conditions (a locator, a response).
- CI changes are reviewed for correctness but **not** claimed to have actually run on GitHub's
  infrastructure — this environment cannot execute remote Actions runs.

**Dependencies**: M5-01 through M5-07.

**Tests**: this item _is_ the Playwright suite; see
[docs/architecture/frontend.md](../architecture/frontend.md) for the full list actually
executed and their results.

**Completion status**: not started

---

## M5-10: Documentation and final verification

**Problem statement**
The frontend architecture, its security boundaries, and its known limitations need to be
written down accurately before this milestone can be considered done.

**Scope**
`docs/architecture/frontend.md` (architecture, Server/Client boundaries, the API client,
auth/CSRF integration, tenant-data isolation, state management, cache invalidation, error
handling, testing, accessibility, known limitations); README updates (features, setup, testing
commands, architecture diagram, real screenshots from the running app).

**Acceptance criteria**

- Documentation describes only what is actually implemented and verified — no aspirational
  claims, no fabricated screenshots.
- Final quality gates (format, lint, typecheck, backend unit/integration/security/e2e,
  frontend component tests, Playwright, both production builds) are run for real and their
  actual results reported.

**Dependencies**: M5-01 through M5-09.

**Tests**: none beyond re-running the full suite as a final gate.

**Completion status**: not started
