import { test, expect } from '@playwright/test';
import { register, createProduct, createOrder, uniqueEmail, unique } from './helpers';
import { flushRateLimitRedisDb } from './redis';

test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

/**
 * Milestone 5 identified a gap: no browser-level coverage of two clients racing conflicting
 * order transitions. `apps/api/test/integration/order-cancellation-race.integration-spec.ts`
 * already proves the real guarantee that matters — two truly simultaneous
 * `fulfillOrder`/`releaseReservation` calls against real Postgres resolve to exactly one
 * winner via row-level locking, never both, never neither (see that file's
 * `Promise.allSettled` race). Reliably forcing two real browser network requests to land
 * inside that same sub-millisecond lock window is not practical to do deterministically —
 * doing so would mean either an arbitrary sleep tuned to this machine's timing (explicitly
 * disallowed) or a test-only synchronization hook injected into production code (its own,
 * worse risk). Per the milestone brief's own fallback: this test instead proves what a real
 * two-tab scenario actually produces — a second client whose page is already open and still
 * shows the order as pending attempts a transition *after* the first client's transition has
 * already completed. That is what the UI's conflict-handling code path
 * (`order-detail-view.tsx`'s 409 catch) exists for, and is exactly as real a scenario as a
 * literal simultaneous race: two staff members (or one staff member with two tabs) looking at
 * the same order, one already having acted on it.
 */
test('a second client attempting to cancel an order the first client already fulfilled gets a real conflict, never a false success', async ({
  page,
  context,
}) => {
  await register(page, {
    name: 'Race Owner',
    orgName: unique('Race Org'),
    email: uniqueEmail('race'),
  });
  await createProduct(page, {
    sku: unique('RACE-SKU'),
    name: 'Race Widget',
    priceDollars: '15.00',
    initialOnHand: 10,
  });
  const orderId = await createOrder(page, 'Race Widget', 4);

  // A second tab, sharing the same authenticated session (the same realistic shape as one
  // staff member with two tabs open, or two staff members both viewing the same order) — both
  // load the order detail page while it is still genuinely pending.
  const otherTab = await context.newPage();
  await otherTab.goto(`/dashboard/orders/${orderId}`);
  await expect(otherTab.getByText('Pending').first()).toBeVisible();

  // Client 1 fulfills the order first, through the real UI, and it genuinely succeeds.
  await page.goto(`/dashboard/orders/${orderId}`);
  await page.getByRole('button', { name: /^fulfill order$/i }).click();
  await page
    .getByRole('button', { name: /^fulfill order$/i })
    .last()
    .click();
  await expect(page.getByText('Fulfilled').first()).toBeVisible();

  // Client 2's page was loaded before that happened and still shows the order as pending in
  // its own component state — exactly the situation a real second tab would be in. Attempting
  // to cancel from here must reach the real backend, which must reject it: the order is no
  // longer pending by the time this request arrives, no matter what client 2's stale view says.
  await otherTab.getByRole('button', { name: /^cancel order$/i }).click();
  await otherTab
    .getByRole('button', { name: /^cancel order$/i })
    .last()
    .click();

  // The losing operation gets a real, meaningful conflict response — never a silent success.
  await expect(otherTab.getByText(/cannot be released/i)).toBeVisible();
  // No false "Cancelled" success ever appears on the losing client.
  await expect(otherTab.getByText('Cancelled')).toHaveCount(0);

  // Client 2's UI refreshes to the real authoritative state after the failed attempt: the
  // order shows as Fulfilled, and neither transition control remains (the order is terminal).
  await expect(otherTab.getByText('Fulfilled').first()).toBeVisible();
  await expect(otherTab.getByRole('button', { name: /^fulfill order$/i })).toHaveCount(0);
  await expect(otherTab.getByRole('button', { name: /^cancel order$/i })).toHaveCount(0);

  // Inventory reflects exactly one transition (the fulfillment) — never touched twice, and
  // never showing a mix of both a consumed and a released reservation.
  await otherTab.goto('/dashboard/inventory');
  const row = otherTab.getByRole('row').filter({ hasText: 'Race Widget' });
  await expect(row.getByRole('cell').nth(2)).toHaveText('6'); // on hand: 10 - 4 fulfilled
  await expect(row.getByRole('cell').nth(3)).toHaveText('0'); // reserved: released by fulfillment
  await expect(row.getByRole('cell').nth(4)).toHaveText('6'); // available: unchanged by the failed cancel
});
