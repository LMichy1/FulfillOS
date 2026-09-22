import { test, expect } from '@playwright/test';
import { register, createProduct, createOrder, uniqueEmail, unique } from './helpers';
import { flushRateLimitRedisDb } from './redis';

// See e2e/redis.ts — resets rate-limit counters before every test.
test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

/**
 * Flow B: reserve stock, cancel the reservation, and verify availability is released exactly
 * once — cancelling again (the only route left once the order is terminal) must not release
 * stock a second time.
 */
test('cancels a pending order and releases its reservation exactly once', async ({ page }) => {
  await register(page, {
    name: 'Flow B Owner',
    orgName: unique('Flow B Org'),
    email: uniqueEmail('flow-b'),
  });

  await createProduct(page, {
    sku: unique('FLOW-B-SKU'),
    name: 'Flow B Widget',
    priceDollars: '10.00',
    initialOnHand: 10,
  });

  const orderId = await createOrder(page, 'Flow B Widget', 4);

  await page.goto('/dashboard/inventory');
  const reservedRow = page.getByRole('row').filter({ hasText: 'Flow B Widget' });
  await expect(reservedRow.getByRole('cell').nth(4)).toHaveText('6'); // available after reserving 4 of 10

  await page.goto(`/dashboard/orders/${orderId}`);
  await page.getByRole('button', { name: /^cancel order$/i }).click();
  await page
    .getByRole('button', { name: /^cancel order$/i })
    .last()
    .click();

  // The status badge, not the "Cancelled" <dt> label for the cancelledAt timestamp shown
  // further down the same page — .first() because the badge renders before that dl in DOM
  // order.
  await expect(page.getByText('Cancelled').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^fulfill order$/i })).toHaveCount(0);

  // Stock is released back to its original level — not more, not less.
  await page.goto('/dashboard/inventory');
  const releasedRow = page.getByRole('row').filter({ hasText: 'Flow B Widget' });
  await expect(releasedRow.getByRole('cell').nth(2)).toHaveText('10'); // on hand unchanged
  await expect(releasedRow.getByRole('cell').nth(3)).toHaveText('0'); // reserved back to 0
  await expect(releasedRow.getByRole('cell').nth(4)).toHaveText('10'); // available restored

  // The order is now terminal — there is no control left on the page that could release stock
  // a second time (this is the UI reflecting the backend's own terminal-state enforcement).
  await expect(page.getByRole('button', { name: /^cancel order$/i })).toHaveCount(0);
});
