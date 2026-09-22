import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple';

/** Every test that creates data uses a unique label so runs never collide with leftover data
 * from a previous run (see e2e/global-setup.ts for why the database isn't truncated between
 * runs) or with each other when run in parallel. */
export function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function uniqueEmail(label: string): string {
  return `${unique(label)}@example.com`;
}

export interface RegisterParams {
  name: string;
  orgName: string;
  email: string;
}

/** Registers a fresh user + organization through the real UI and confirms the redirect to the
 * authenticated dashboard — the common first step nearly every flow in this suite needs. */
export async function register(page: Page, params: RegisterParams): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Your name').fill(params.name);
  await page.getByLabel('Organization name').fill(params.orgName);
  await page.getByLabel('Email').fill(params.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
}

export interface CreateProductParams {
  sku: string;
  name: string;
  priceDollars: string;
  initialOnHand?: number;
}

/** Creates a product through the real creation form and returns its detail-page id, parsed
 * from the URL the app redirects to on success — never asserted optimistically before that
 * redirect actually happens. */
export async function createProduct(page: Page, params: CreateProductParams): Promise<string> {
  await page.goto('/dashboard/products/new');
  await page.getByLabel('SKU').fill(params.sku);
  await page.getByLabel('Name').fill(params.name);
  await page.getByLabel('Price (USD)').fill(params.priceDollars);
  if (params.initialOnHand !== undefined) {
    await page.getByLabel('Initial stock (optional)').fill(String(params.initialOnHand));
  }
  await page.getByRole('button', { name: /create product/i }).click();
  // A real product id is a UUID — matched explicitly (not `[^/]+`, which would also match a
  // literal "new" and falsely appear to pass if creation failed and the page never navigated
  // away from /dashboard/products/new).
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  await expect(page).toHaveURL(new RegExp(`/dashboard/products/${uuid.source}$`, 'i'));
  const url = page.url();
  const match = new RegExp(`/products/(${uuid.source})$`, 'i').exec(url);
  if (!match) {
    throw new Error(`Could not parse product id from URL: ${url}`);
  }
  return match[1];
}

/** Creates a single-line order through the real order-creation workflow and returns its id,
 * parsed from the redirect to the order detail page. */
export async function createOrder(
  page: Page,
  productName: string,
  quantity: number,
): Promise<string> {
  await page.goto('/dashboard/orders/new');
  await page.getByLabel('Product').click();
  await page.getByRole('option', { name: new RegExp(productName) }).click();
  await page.getByLabel('Quantity').fill(String(quantity));
  await page.getByRole('button', { name: /^add line$/i }).click();
  await page.getByRole('button', { name: /^create order$/i }).click();
  // A real order id is a UUID — see createProduct's identical reasoning above for why this
  // can't be a loose `[^/]+` match.
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  await expect(page).toHaveURL(new RegExp(`/dashboard/orders/${uuid.source}$`, 'i'));
  const url = page.url();
  const match = new RegExp(`/orders/(${uuid.source})$`, 'i').exec(url);
  if (!match) {
    throw new Error(`Could not parse order id from URL: ${url}`);
  }
  return match[1];
}

export async function getAvailableQuantity(page: Page, productName: string): Promise<number> {
  await page.goto('/dashboard/inventory');
  const row = page.getByRole('row').filter({ hasText: productName });
  const cells = await row.getByRole('cell').allTextContents();
  // Product | SKU | On hand | Reserved | Available | Status | (Actions)
  return Number(cells[4]);
}
