import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';
// Reused directly from apps/api rather than duplicated: the exact same safety checks the
// Jest integration/security suites rely on (must differ from DATABASE_URL, must contain
// "test", rejects known non-test names, hard-stops under NODE_ENV=production) — see
// apps/api/scripts/lib/test-database-url.ts.
import { resolveTestDatabaseUrl } from '../api/scripts/lib/test-database-url';

// apps/web has no .env of its own; the shared one lives at the repo root (see
// .env.example) and is what apps/api's own scripts load too.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Playwright launches its own API and web server instances and waits for both to be ready —
 * it does not depend on a developer having already started `pnpm dev:api`/`dev:web`. Ports are
 * distinct from the normal dev ports (3001/3000) specifically so this can run alongside a
 * manually-started dev server without a conflict.
 *
 * The API instance's `DATABASE_URL` is set to the same isolated, distinct-role test database
 * (`fulfillos_test`) the Jest integration/security suites already use — reusing its exact
 * isolation guarantees (a role denied CONNECT on the development database — see
 * docs/architecture/inventory.md's Milestone 3 preflight history) rather than inventing a
 * second one. This is a real, normal running instance of the actual app — nothing here is a
 * special "test mode" — it is simply pointed at an isolated database for this process only,
 * the same technique test/security/setup/env.ts already uses for the Jest security suite. See
 * ./e2e/global-setup.ts for the one-time migration + clean-slate truncation this depends on,
 * and docs/architecture/frontend.md#testing for the full reasoning.
 */
const TEST_DATABASE_URL = resolveTestDatabaseUrl();

const API_PORT = process.env.PLAYWRIGHT_API_PORT ?? '3011';
const WEB_PORT = process.env.PLAYWRIGHT_WEB_PORT ?? '3010';
// A distinct Redis logical database, separate from dev's (implicit db 0) and the Jest security
// suite's (db 1 — see test/security/setup/env.ts) — this suite's own `RateLimitGuard` counters
// (register: 5/15min/IP, login: 10/15min/IP) would otherwise be shared with whichever of those
// happened to run recently, and a single Playwright run already registers more than 5 accounts
// across its 14 tests. e2e/global-setup.ts flushes this database before every run for a clean
// slate, the same way it re-runs (idempotent) migrations.
const PLAYWRIGHT_REDIS_URL = process.env.PLAYWRIGHT_REDIS_URL ?? 'redis://localhost:6379/2';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/global-setup.ts', '**/fixtures/**'],
  // e2e/global-setup.ts pre-warms every route so a test's first navigation to it doesn't pay a
  // cold Turbopack compile; this margin is for genuine variance under load, not compilation.
  timeout: 60_000,
  retries: 0,
  // A single Node dev API + a Turbopack dev web server already saturate this machine's 4 cores;
  // running tests one at a time avoids CPU-contention-induced flakiness (observed: Argon2id
  // hashing and Postgres queries from a second worker's test starving the first's).
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  // Argon2id password hashing (register, then login) is intentionally slow, and under this
  // machine's concurrent 2-worker load that can exceed the default 5s assertion timeout on the
  // very first post-registration redirect — a real latency characteristic, not a hung test.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @fulfillos/api run start:dev',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      // nest start --watch performs a full cold webpack-style compile before its first listen —
      // consistently over a minute on this machine, well past a 60s allowance.
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: API_PORT,
        NODE_ENV: 'test',
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: PLAYWRIGHT_REDIS_URL,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `pnpm --filter @fulfillos/web exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      // Turbopack compiles the first-requested route on demand; under load this machine has
      // seen a cold compile of "/" take over 90s.
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
