import { test, expect } from '@playwright/test';
import { register, createProduct, uniqueEmail, unique } from './helpers';
import { expireSession, closeE2eDb } from './db';
import { flushRateLimitRedisDb } from './redis';

// See e2e/redis.ts — resets rate-limit counters before every test.
test.beforeEach(async () => {
  await flushRateLimitRedisDb();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test('shows a clear error when reserving more stock than is available', async ({ page }) => {
  await register(page, {
    name: 'Flow E Owner',
    orgName: unique('Flow E Stock Org'),
    email: uniqueEmail('flow-e-stock'),
  });
  await createProduct(page, {
    sku: unique('FLOW-E-STOCK-SKU'),
    name: 'Flow E Scarce Widget',
    priceDollars: '7.00',
    initialOnHand: 2,
  });

  await page.goto('/dashboard/orders/new');
  await page.getByLabel('Product').click();
  await page.getByRole('option', { name: /Flow E Scarce Widget/ }).click();
  await page.getByLabel('Quantity').fill('5');
  await page.getByRole('button', { name: /^add line$/i }).click();
  await page.getByRole('button', { name: /^create order$/i }).click();

  // Not getByRole('alert') alone — Next.js's own route announcer
  // (#__next-route-announcer__) also has role="alert" and would make this locator ambiguous
  // (see e2e/auth.spec.ts's equivalent comment). Not a loose /insufficient|stock/i pattern
  // either — that also matches this org's name ("...Stock Org-...") and the page's own
  // description text ("Reserve stock across..."); "insufficient stock" together is unique to
  // the actual error message.
  await expect(page.getByText(/insufficient stock/i)).toBeVisible();
  // Still on the creation form — no order was created, and success was never claimed
  // optimistically.
  await expect(page).toHaveURL(/\/dashboard\/orders\/new$/);
});

test('rejects invalid product input on the client before it would reach the API', async ({
  page,
}) => {
  await register(page, {
    name: 'Flow E Form Owner',
    orgName: unique('Flow E Form Org'),
    email: uniqueEmail('flow-e-form'),
  });

  await page.goto('/dashboard/products/new');
  // Leave SKU and name blank, enter a malformed price.
  await page.getByLabel('Price (USD)').fill('not-a-price');
  await page.getByRole('button', { name: /create product/i }).click();

  await expect(page.getByText('SKU is required.')).toBeVisible();
  await expect(page.getByText('Name is required.')).toBeVisible();
  await expect(page.getByText(/enter a valid price/i)).toBeVisible();
  // No navigation happened — the invalid submission never reached the API.
  await expect(page).toHaveURL(/\/dashboard\/products\/new$/);
});

test('rejects a duplicate SKU with a clear conflict message', async ({ page }) => {
  await register(page, {
    name: 'Flow E Dup Owner',
    orgName: unique('Flow E Dup Org'),
    email: uniqueEmail('flow-e-dup'),
  });
  const sku = unique('FLOW-E-DUP-SKU');
  await createProduct(page, { sku, name: 'First Widget', priceDollars: '3.00' });

  await page.goto('/dashboard/products/new');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel('Name').fill('Second Widget');
  await page.getByLabel('Price (USD)').fill('4.00');
  await page.getByRole('button', { name: /create product/i }).click();

  await expect(page.getByText(/already exists/i)).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/products\/new$/);
});

test('an expired session redirects to login instead of silently failing', async ({ page }) => {
  const email = uniqueEmail('flow-e-expired');
  await register(page, {
    name: 'Flow E Expired Owner',
    orgName: unique('Flow E Expired Org'),
    email,
  });

  await expireSession(email);

  // The existing session cookie is still present in the browser, but the server-side session
  // it refers to is now expired — the real security boundary (see
  // docs/architecture/authentication.md), not a frontend-only check.
  await page.goto('/dashboard/products');
  await expect(page).toHaveURL(/\/login$/);
});

test('does not create a second order from a rapid double submission', async ({ page }) => {
  await register(page, {
    name: 'Flow E Double Owner',
    orgName: unique('Flow E Double Org'),
    email: uniqueEmail('flow-e-double'),
  });
  await createProduct(page, {
    sku: unique('FLOW-E-DOUBLE-SKU'),
    name: 'Flow E Double Widget',
    priceDollars: '6.00',
    initialOnHand: 10,
  });

  await page.goto('/dashboard/orders/new');
  await page.getByLabel('Product').click();
  await page.getByRole('option', { name: /Flow E Double Widget/ }).click();
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: /^add line$/i }).click();

  const submit = page.getByRole('button', { name: /create order|reserving/i });
  // A second click fired immediately after the first, without waiting for navigation: the
  // component disables the button synchronously on submit (see its `disabled={submitting}`),
  // so this second click either lands on an already-disabled button (a no-op) or misses
  // entirely because the page has already navigated away — either way it must never start a
  // second reservation request. Real-world duplicate submissions (a double-click, a retried
  // click after a slow response) are variations of this same race.
  await submit.click();
  await submit.click({ trial: true }).catch(() => {});

  // A real order id is a UUID, not the literal "new" — see e2e/helpers.ts's createOrder for
  // why a loose `[^/]+` match would mask a failed creation.
  await expect(page).toHaveURL(
    /\/dashboard\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  await page.goto('/dashboard/orders');
  const rows = page.getByRole('row').filter({ hasText: 'Pending' });
  await expect(rows).toHaveCount(1);
});
