import { test, expect } from '@playwright/test';

/**
 * Exercises the real NestJS API through the real browser UI — no mocked fetch, no fabricated
 * auth state. Runs against whatever apps/api + Postgres + Redis instance is already up (see
 * playwright.config.ts). Each run uses a fresh, uniquely-generated email so it doesn't collide
 * with data from a previous run or require a database reset between runs.
 */

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

const PASSWORD = 'correct horse battery staple';

test('registration, protected navigation, logout, and login all work end-to-end', async ({
  page,
}) => {
  const email = uniqueEmail('playwright');

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Playwright User');
  await page.getByLabel('Organization name').fill('Playwright Org');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();

  // Successful registration + auto-login redirects to the authenticated dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByText('Playwright Org')).toBeVisible();

  // Log out.
  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The dashboard is not actually protected by the frontend alone: without a session, the
  // API's /auth/me rejects the request and the page redirects back to /login. Confirm that
  // redirect actually happens rather than the dashboard silently rendering with no data.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  // Log back in with the same credentials.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});

test('shows a generic error for invalid login credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail('nonexistent'));
  await page.getByLabel('Password').fill('whatever-password');
  await page.getByRole('button', { name: /^log in$/i }).click();

  // Next.js's own route announcer also has role="alert", so scope to our own error text
  // rather than getByRole('alert') alone.
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  // Still on the login page — no navigation happened.
  await expect(page).toHaveURL(/\/login$/);
});

test('an owner can rename their organization', async ({ page }) => {
  const email = uniqueEmail('owner-rename');

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Organization name').fill('Original Name');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByLabel('Organization name').fill('Renamed via Playwright');
  await page.getByRole('button', { name: /^save$/i }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Renamed via Playwright' })).toBeVisible();
});
