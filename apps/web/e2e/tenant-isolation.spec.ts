import { test, expect } from '@playwright/test';
import { register, createProduct, uniqueEmail, unique } from './helpers';
import { addStaffMembership, closeE2eDb } from './db';
import { flushRateLimitRedisDb } from './redis';

/**
 * Flow D: switching between two organizations the same user belongs to must never expose the
 * other organization's data — not in the product list, and not left over in a form.
 */
test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test('switching organizations shows only the selected organization’s products, never a mix', async ({
  page,
}) => {
  const orgAName = unique('Flow D Org A');
  const email = uniqueEmail('flow-d');
  await register(page, { name: 'Flow D User', orgName: orgAName, email });
  await createProduct(page, {
    sku: unique('FLOW-D-A-SKU'),
    name: 'Org A Exclusive Widget',
    priceDollars: '12.00',
  });

  // A second organization, created by a different account, then this same user added to it —
  // giving one user two organizations with distinct data, so switching is meaningfully
  // observable (this is the direct-DB equivalent of an invitation flow that doesn't exist yet).
  const orgBName = unique('Flow D Org B');
  const otherEmail = uniqueEmail('flow-d-other');
  await register(page, { name: 'Flow D Other Owner', orgName: orgBName, email: otherEmail });
  await createProduct(page, {
    sku: unique('FLOW-D-B-SKU'),
    name: 'Org B Exclusive Widget',
    priceDollars: '18.00',
  });
  await addStaffMembership(email, orgBName);

  // Log back in as the shared user, currently viewing Org A (or Org B — the initially-selected
  // organization order is not asserted here; what matters is what each explicit switch shows).
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);

  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgAName }).click();
  await page.goto('/dashboard/products');
  await expect(page.getByText('Org A Exclusive Widget')).toBeVisible();
  await expect(page.getByText('Org B Exclusive Widget')).toHaveCount(0);

  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgBName }).click();
  // Switching remounts the page (keyed by organization id — see
  // app/dashboard/layout.tsx) so this navigation lands on a fresh fetch for the new
  // organization, never a stale render of Org A's list.
  await expect(page.getByText('Org B Exclusive Widget')).toBeVisible();
  await expect(page.getByText('Org A Exclusive Widget')).toHaveCount(0);

  // Switch back — confirms the isolation holds in both directions, not just once.
  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgAName }).click();
  await expect(page.getByText('Org A Exclusive Widget')).toBeVisible();
  await expect(page.getByText('Org B Exclusive Widget')).toHaveCount(0);
});

test('switching organizations clears a product picker that referenced the previous tenant', async ({
  page,
}) => {
  const orgAName = unique('Flow D Form Org A');
  const email = uniqueEmail('flow-d-form');
  await register(page, { name: 'Flow D Form User', orgName: orgAName, email });
  await createProduct(page, {
    sku: unique('FLOW-D-FORM-A-SKU'),
    name: 'Form Org A Widget',
    priceDollars: '9.00',
    initialOnHand: 5,
  });

  const orgBName = unique('Flow D Form Org B');
  const otherEmail = uniqueEmail('flow-d-form-other');
  await register(page, { name: 'Flow D Form Other', orgName: orgBName, email: otherEmail });
  await addStaffMembership(email, orgBName);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);

  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgAName }).click();
  await page.goto('/dashboard/orders/new');
  await expect(page.getByText('Form Org A Widget')).toHaveCount(0); // not selected, just present as an option once opened
  await page.getByLabel('Product').click();
  await expect(page.getByRole('option', { name: /Form Org A Widget/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Switch to the organization with no products at all — the picker must not still offer
  // Org A's product (the remount-on-switch behavior clearing it, not a manual reset).
  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgBName }).click();
  await page.goto('/dashboard/orders/new');
  await page.getByLabel('Product').click();
  await expect(page.getByText('No products in this organization yet.')).toBeVisible();
});
