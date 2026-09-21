import { defineConfig } from '@playwright/test';

/**
 * Assumes both apps/api and apps/web are already running (see README's "Playwright tests"
 * section) — this deliberately does not auto-start either server itself, since the API needs
 * a real Postgres + Redis it's the developer/CI's responsibility to have provisioned first.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
});
