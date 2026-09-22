// Runs the existing, already-safety-checked test-database migration script (see
// apps/api/scripts/migrate-test.ts and scripts/lib/test-database-url.ts) once before
// Playwright starts its own API/web server instances — so every E2E run's isolated database
// is guaranteed to be migrated, without duplicating that script's logic or requiring
// apps/web to depend on drizzle-orm/pg directly for a tooling-only step. Deliberately does
// not truncate the database first: migrations are additive and idempotent, and every test in
// this suite already uses uniquely-generated emails/SKUs (see e2e/*.spec.ts), so leftover data
// from a previous run cannot collide with a fresh one.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { flushRateLimitRedisDb } from './redis';

const WEB_PORT = process.env.PLAYWRIGHT_WEB_PORT ?? '3010';

// Turbopack's dev server compiles each route on its first request, not up front. Left
// uncompiled, a test's first navigation to a brand-new route can itself take 30-50s on this
// machine, and a single flow that visits several never-before-compiled routes (register, then
// a product, then an order, then inventory) can exceed the whole test's timeout on nothing but
// compilation — a pure environment/tooling cost, not applicaton latency. Fetching each route
// once here — after Playwright's own webServer readiness check has already confirmed both
// servers are up, before any test's clock starts — pays that cost exactly once, up front, so
// every test measures real app behavior instead of racing a cold compile. Dynamic segments are
// warmed with a placeholder id: Next.js compiles the route module for any id that matches the
// pattern, regardless of whether a real record exists downstream.
const ROUTES_TO_WARM = [
  '/',
  '/login',
  '/register',
  '/dashboard',
  '/dashboard/overview',
  '/dashboard/products',
  '/dashboard/products/new',
  '/dashboard/products/warmup',
  '/dashboard/inventory',
  '/dashboard/orders',
  '/dashboard/orders/new',
  '/dashboard/orders/warmup',
  '/dashboard/settings',
];

async function warmRoutes(): Promise<void> {
  for (const route of ROUTES_TO_WARM) {
    try {
      await fetch(`http://localhost:${WEB_PORT}${route}`);
    } catch {
      // A route that 404s, redirects, or errors downstream has still been compiled and served
      // once — that's all this step needs. A genuine connection failure here just means the
      // very first real test navigation pays the compile cost instead, not a broken run.
    }
  }
}

export default async function globalSetup(): Promise<void> {
  execFileSync('pnpm', ['run', 'db:migrate:test'], {
    cwd: path.resolve(__dirname, '../../api'),
    stdio: 'inherit',
  });
  await flushRateLimitRedisDb();
  await warmRoutes();
}
