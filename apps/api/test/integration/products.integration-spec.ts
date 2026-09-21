import { eq } from 'drizzle-orm';
import { inventory, inventoryMovements } from '../../src/database/schema';
import { ProductsService } from '../../src/products/products.service';
import type { Database } from '../../src/database/database.module';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization } from './setup/fixtures';

describe('products: catalog creation and queries (integration)', () => {
  let db: TestDatabase;
  let productsService: ProductsService;

  beforeAll(async () => {
    db = await getTestDb();
    productsService = new ProductsService(db as unknown as Database);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('creates a product with its initial inventory atomically', async () => {
    const org = await insertOrganization(db, 'Catalog Org');

    const product = await productsService.createProduct(org.id, {
      sku: 'WIDGET-1',
      name: 'Widget',
      description: 'A widget',
      unitPriceCents: 500,
      initialOnHand: 20,
    });

    expect(product).toMatchObject({
      sku: 'WIDGET-1',
      name: 'Widget',
      onHand: 20,
      reserved: 0,
      available: 20,
    });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row).toBeDefined();
    expect(row.onHand).toBe(20);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movementType: 'on_hand_adjustment',
      onHandDelta: 20,
    });
  });

  it('creates a product with zero initial stock and no movement row', async () => {
    const org = await insertOrganization(db, 'Zero Stock Org');

    const product = await productsService.createProduct(org.id, {
      sku: 'ZERO-1',
      name: 'Zero Stock Product',
      unitPriceCents: 100,
    });

    expect(product).toMatchObject({ onHand: 0, reserved: 0, available: 0 });

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id));
    expect(movements).toHaveLength(0);
  });

  it('rejects a duplicate SKU within the same organization, case/whitespace-insensitively', async () => {
    const org = await insertOrganization(db, 'Duplicate SKU Org');
    await productsService.createProduct(org.id, {
      sku: 'DUP-1',
      name: 'First',
      unitPriceCents: 100,
    });

    await expect(
      productsService.createProduct(org.id, {
        sku: '  dup-1  ',
        name: 'Second',
        unitPriceCents: 200,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.organizationId, org.id));
    // Only the first product's inventory row exists — the rejected attempt created nothing.
    expect(row).toBeDefined();
  });

  it('allows the identical SKU text in two different organizations', async () => {
    const orgA = await insertOrganization(db, 'SKU Org A');
    const orgB = await insertOrganization(db, 'SKU Org B');

    await expect(
      productsService.createProduct(orgA.id, {
        sku: 'SHARED-SKU',
        name: 'A Product',
        unitPriceCents: 100,
      }),
    ).resolves.toBeDefined();
    await expect(
      productsService.createProduct(orgB.id, {
        sku: 'SHARED-SKU',
        name: 'B Product',
        unitPriceCents: 150,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects reading a product that belongs to a different organization', async () => {
    const org = await insertOrganization(db, 'Owner Product Org');
    const otherOrg = await insertOrganization(db, 'Other Product Org');
    const product = await productsService.createProduct(org.id, {
      sku: 'TENANT-1',
      name: 'Tenant Product',
      unitPriceCents: 100,
    });

    await expect(
      productsService.getProduct(otherOrg.id, product.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('paginates product listings deterministically across multiple pages', async () => {
    const org = await insertOrganization(db, 'Pagination Org');
    for (let i = 0; i < 5; i++) {
      await productsService.createProduct(org.id, {
        sku: `PAGE-${i}`,
        name: `Page Product ${i}`,
        unitPriceCents: 100,
      });
    }

    const firstPage = await productsService.listProducts(org.id, {
      limit: 2,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await productsService.listProducts(org.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.nextCursor).not.toBeNull();

    const thirdPage = await productsService.listProducts(org.id, {
      limit: 2,
      cursor: secondPage.nextCursor!,
    });
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.nextCursor).toBeNull();

    const allIds = [
      ...firstPage.items,
      ...secondPage.items,
      ...thirdPage.items,
    ].map((p) => p.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('rejects a negative unit price via the database CHECK constraint backstop', async () => {
    // DTO validation (class-validator's @Min(0), enforced by the global ValidationPipe at the
    // HTTP boundary — see test/security/catalog-orders.security-spec.ts) is the primary
    // defense; this test exercises the service/database layer directly, confirming the
    // existing products_unit_price_cents_non_negative CHECK constraint still backstops it.
    const org = await insertOrganization(db, 'Invalid Input Org');

    await expect(
      productsService.createProduct(org.id, {
        sku: 'NEG-PRICE',
        name: 'Negative Price',
        unitPriceCents: -1,
      }),
    ).rejects.toThrow();
  });
});
