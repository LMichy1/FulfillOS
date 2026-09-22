import { test, expect } from '@playwright/test';
import { register, createProduct, createOrder, uniqueEmail, unique } from './helpers';
import { flushRateLimitRedisDb } from './redis';

// See e2e/redis.ts — resets rate-limit counters before every test.
test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

/**
 * Flow A: the complete product -> reservation -> fulfillment workflow, entirely through the
 * real UI against the real NestJS API and the isolated Playwright test database (see
 * e2e/global-setup.ts and playwright.config.ts) — no mocked backend, no fabricated success
 * states.
 */
test('creates a product, reserves stock, fulfills the order, and verifies inventory throughout', async ({
  page,
}) => {
  await register(page, {
    name: 'Flow A Owner',
    orgName: unique('Flow A Org'),
    email: uniqueEmail('flow-a'),
  });

  const sku = unique('FLOW-A-SKU');
  const productId = await createProduct(page, {
    sku,
    name: 'Flow A Widget',
    priceDollars: '25.00',
    initialOnHand: 20,
  });

  // Product detail confirms the initial stock was set atomically at creation.
  await page.goto(`/dashboard/products/${productId}`);
  await expect(page.getByText('20', { exact: true }).first()).toBeVisible();

  const orderId = await createOrder(page, 'Flow A Widget', 6);

  // The order was actually created and is pending — never assumed from the form alone.
  await expect(page.getByText('Pending')).toBeVisible();

  // Available inventory decreased by exactly the reserved quantity; on-hand is unchanged.
  await page.goto('/dashboard/inventory');
  const inventoryRow = page.getByRole('row').filter({ hasText: 'Flow A Widget' });
  await expect(inventoryRow.getByRole('cell').nth(2)).toHaveText('20'); // on hand
  await expect(inventoryRow.getByRole('cell').nth(3)).toHaveText('6'); // reserved
  await expect(inventoryRow.getByRole('cell').nth(4)).toHaveText('14'); // available

  // Fulfill the order.
  await page.goto(`/dashboard/orders/${orderId}`);
  await page.getByRole('button', { name: /^fulfill order$/i }).click();
  await page
    .getByRole('button', { name: /^fulfill order$/i })
    .last()
    .click();

  // Verify the fulfilled status is shown after the backend actually confirms it. The status
  // badge, not the "Fulfilled" <dt> label for the fulfilledAt timestamp shown further down the
  // same page — .first() because the badge renders before that dl in DOM order.
  await expect(page.getByText('Fulfilled').first()).toBeVisible();
  // The fulfill/cancel controls disappear once the order is terminal.
  await expect(page.getByRole('button', { name: /^cancel order$/i })).toHaveCount(0);

  // On-hand and reserved both decrease by the fulfilled quantity; available is unchanged from
  // its post-reservation value (fulfillment consumes stock that was already unavailable).
  await page.goto('/dashboard/inventory');
  const afterRow = page.getByRole('row').filter({ hasText: 'Flow A Widget' });
  await expect(afterRow.getByRole('cell').nth(2)).toHaveText('14'); // on hand
  await expect(afterRow.getByRole('cell').nth(3)).toHaveText('0'); // reserved
  await expect(afterRow.getByRole('cell').nth(4)).toHaveText('14'); // available
});
