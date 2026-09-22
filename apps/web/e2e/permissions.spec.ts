import { test, expect } from '@playwright/test';
import { register, login, uniqueEmail, unique } from './helpers';
import { addStaffMembership, closeE2eDb } from './db';
import { flushRateLimitRedisDb } from './redis';

/**
 * Flow C: a staff member cannot perform owner-only operations. The hidden button is only a UX
 * convenience — the actual assertion that matters is the backend's own 403, reached here by
 * navigating directly to the creation route the UI itself never links to for a staff member.
 */
test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test('a staff member cannot create products; the backend rejects it, not just the hidden button', async ({
  page,
}) => {
  const orgName = unique('Flow C Org');
  const ownerEmail = uniqueEmail('flow-c-owner');
  await register(page, { name: 'Flow C Owner', orgName, email: ownerEmail });

  // A second account, added as `staff` on the owner's organization directly (there is no
  // invitation flow yet — see docs/architecture/frontend.md#known-limitations).
  const staffEmail = uniqueEmail('flow-c-staff');
  await register(page, {
    name: 'Flow C Staff',
    orgName: unique('Flow C Staff Own Org'),
    email: staffEmail,
  });
  await addStaffMembership(staffEmail, orgName);

  // Log back in as staff and switch to the owner's organization.
  await login(page, staffEmail);
  const orgSwitcher = page.getByLabel('Switch organization');
  await orgSwitcher.click();
  await page.getByRole('option', { name: orgName }).click();

  // The UI itself never shows a "New product" button for a staff member.
  await page.goto('/dashboard/products');
  await expect(page.getByRole('button', { name: /new product/i })).toHaveCount(0);

  // Navigating directly to the creation route and submitting is still rejected by the
  // backend's own RolesGuard — confirmed here, not assumed from the hidden button.
  await page.goto('/dashboard/products/new');
  await page.getByLabel('SKU').fill(unique('FLOW-C-STAFF-SKU'));
  await page.getByLabel('Name').fill('Staff Attempted Product');
  await page.getByLabel('Price (USD)').fill('5.00');
  await page.getByRole('button', { name: /create product/i }).click();

  // Not getByRole('alert') alone — Next.js's own route announcer
  // (#__next-route-announcer__) also has role="alert" and would make this locator ambiguous
  // (see e2e/auth.spec.ts's equivalent comment).
  await expect(page.getByText(/permit|permission|forbidden|owner/i)).toBeVisible();
  // Still on the creation form — no product was created.
  await expect(page).toHaveURL(/\/dashboard\/products\/new$/);
});

test('a staff member cannot see the inventory adjustment control', async ({ page }) => {
  const orgName = unique('Flow C Inv Org');
  const ownerEmail = uniqueEmail('flow-c-inv-owner');
  await register(page, { name: 'Flow C Inv Owner', orgName, email: ownerEmail });

  await page.goto('/dashboard/products/new');
  await page.getByLabel('SKU').fill(unique('FLOW-C-INV-SKU'));
  await page.getByLabel('Name').fill('Flow C Inventory Widget');
  await page.getByLabel('Price (USD)').fill('8.00');
  await page.getByLabel('Initial stock (optional)').fill('5');
  await page.getByRole('button', { name: /create product/i }).click();
  // A real product id is a UUID, not the literal "new" — see e2e/helpers.ts's createProduct
  // for why a loose `[^/]+` match would mask a failed creation.
  await expect(page).toHaveURL(
    /\/dashboard\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  const staffEmail = uniqueEmail('flow-c-inv-staff');
  await register(page, {
    name: 'Flow C Inv Staff',
    orgName: unique('Flow C Inv Staff Own Org'),
    email: staffEmail,
  });
  await addStaffMembership(staffEmail, orgName);

  await login(page, staffEmail);
  await page.getByLabel('Switch organization').click();
  await page.getByRole('option', { name: orgName }).click();

  await page.goto('/dashboard/inventory');
  await expect(page.getByRole('button', { name: /^adjust$/i })).toHaveCount(0);
});
