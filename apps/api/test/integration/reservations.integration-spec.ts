import { eq } from 'drizzle-orm';
import {
  inventory,
  inventoryMovements,
  orders,
} from '../../src/database/schema';
import { ReservationsService } from '../../src/reservations/reservations.service';
import type { Database } from '../../src/database/database.module';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import {
  insertOrganization,
  insertProduct,
  insertInventoryRow,
  insertUser,
} from './setup/fixtures';

describe('reservations: creation and concurrency (integration)', () => {
  let db: TestDatabase;
  let reservationsService: ReservationsService;

  beforeAll(async () => {
    db = await getTestDb();
    reservationsService = new ReservationsService(db as unknown as Database);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function setUpOrgWithUser(orgName: string) {
    const org = await insertOrganization(db, orgName);
    const user = await insertUser(db, {
      email: `${orgName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
      displayName: orgName,
    });
    return { org, user };
  }

  it('creates a multi-product reservation atomically, decrementing available for every line', async () => {
    const { org, user } = await setUpOrgWithUser('Multi Reserve Org');
    const productA = await insertProduct(db, {
      organizationId: org.id,
      sku: 'A-1',
      name: 'Product A',
      unitPriceCents: 100,
    });
    const productB = await insertProduct(db, {
      organizationId: org.id,
      sku: 'B-1',
      name: 'Product B',
      unitPriceCents: 200,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productA.id,
      onHand: 10,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productB.id,
      onHand: 5,
    });

    const result = await reservationsService.createReservation(
      org.id,
      user.id,
      {
        items: [
          { productId: productA.id, quantity: 3 },
          { productId: productB.id, quantity: 2 },
        ],
      },
      'multi-key-1',
    );

    expect(result.status).toBe('pending');
    expect(result.items).toHaveLength(2);

    const [rowA] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productA.id));
    const [rowB] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productB.id));
    expect(rowA.reserved).toBe(3);
    expect(rowB.reserved).toBe(2);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'reservation'));
    expect(movements).toHaveLength(2);
  });

  it('rejects the entire reservation if any line is insufficient, leaving all inventory unchanged', async () => {
    const { org, user } = await setUpOrgWithUser('Insufficient Org');
    const productA = await insertProduct(db, {
      organizationId: org.id,
      sku: 'A-2',
      name: 'Product A',
      unitPriceCents: 100,
    });
    const productB = await insertProduct(db, {
      organizationId: org.id,
      sku: 'B-2',
      name: 'Product B',
      unitPriceCents: 200,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productA.id,
      onHand: 10,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productB.id,
      onHand: 1,
    });

    await expect(
      reservationsService.createReservation(
        org.id,
        user.id,
        {
          items: [
            { productId: productA.id, quantity: 5 },
            { productId: productB.id, quantity: 5 },
          ],
        },
        'insufficient-key-1',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [rowA] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productA.id));
    const [rowB] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productB.id));
    expect(rowA.reserved).toBe(0);
    expect(rowB.reserved).toBe(0);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(0);
  });

  it('rejects duplicate product lines in a single reservation request', async () => {
    const { org, user } = await setUpOrgWithUser('Duplicate Lines Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'DUP-1',
      name: 'Dup Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 10,
    });

    await expect(
      reservationsService.createReservation(
        org.id,
        user.id,
        {
          items: [
            { productId: product.id, quantity: 1 },
            { productId: product.id, quantity: 2 },
          ],
        },
        'dup-key-1',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a reservation containing a product from another organization', async () => {
    const { org, user } = await setUpOrgWithUser('Tenant Reserve Org');
    const otherOrg = await insertOrganization(db, 'Other Reserve Org');
    const foreignProduct = await insertProduct(db, {
      organizationId: otherOrg.id,
      sku: 'FOREIGN-1',
      name: 'Foreign Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: otherOrg.id,
      productId: foreignProduct.id,
      onHand: 10,
    });

    await expect(
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: foreignProduct.id, quantity: 1 }] },
        'tenant-key-1',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('exactly one of two simultaneous reservations for the last unit succeeds', async () => {
    const { org, user } = await setUpOrgWithUser('Last Unit Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'LAST-1',
      name: 'Last Unit Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 1,
    });

    const [resultA, resultB] = await Promise.allSettled([
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 1 }] },
        'last-unit-key-a',
      ),
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 1 }] },
        'last-unit-key-b',
      ),
    ]);

    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
    });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(1);
    expect(row.reserved).toBe(1);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(1);
  }, 15000);

  it('exactly 3 of 10 simultaneous reservations succeed against a stock of 3', async () => {
    const { org, user } = await setUpOrgWithUser('Ten Concurrent Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'TEN-1',
      name: 'Ten Concurrent Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 3,
    });

    const attempts = Array.from({ length: 10 }, (_, i) =>
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 1 }] },
        `ten-key-${i}`,
      ),
    );

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
      });
    }

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(3);
    expect(row.reserved).toBe(3);
  }, 20000);

  it('does not deadlock when concurrent multi-product reservations list the same products in opposite order', async () => {
    const { org, user } = await setUpOrgWithUser('Opposite Order Org');
    const productA = await insertProduct(db, {
      organizationId: org.id,
      sku: 'OPP-A',
      name: 'Opposite Order A',
      unitPriceCents: 100,
    });
    const productB = await insertProduct(db, {
      organizationId: org.id,
      sku: 'OPP-B',
      name: 'Opposite Order B',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productA.id,
      onHand: 5,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: productB.id,
      onHand: 5,
    });

    const [resultA, resultB] = await Promise.allSettled([
      reservationsService.createReservation(
        org.id,
        user.id,
        {
          items: [
            { productId: productA.id, quantity: 1 },
            { productId: productB.id, quantity: 1 },
          ],
        },
        'opp-key-a',
      ),
      reservationsService.createReservation(
        org.id,
        user.id,
        {
          items: [
            { productId: productB.id, quantity: 1 },
            { productId: productA.id, quantity: 1 },
          ],
        },
        'opp-key-b',
      ),
    ]);

    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('fulfilled');

    const [rowA] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productA.id));
    const [rowB] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productB.id));
    expect(rowA.reserved).toBe(2);
    expect(rowB.reserved).toBe(2);
  }, 15000);

  it('concurrent stock adjustment and reservation on the same product never violate inventory invariants', async () => {
    const { org, user } = await setUpOrgWithUser('Race Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'RACE-1',
      name: 'Race Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 5,
    });

    // Import lazily to avoid a module-level dependency cycle between test files.
    const { InventoryService } =
      await import('../../src/inventory/inventory.service');
    const inventoryService = new InventoryService(db as unknown as Database);

    const [adjustResult, reserveResult] = await Promise.allSettled([
      inventoryService.adjustStock(
        org.id,
        { productId: product.id, delta: -5, reason: 'shrinkage' },
        'race-adjust-key',
      ),
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 3 }] },
        'race-reserve-key',
      ),
    ]);

    const outcomes = [adjustResult, reserveResult];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBeGreaterThanOrEqual(0);
    expect(row.reserved).toBeGreaterThanOrEqual(0);
    expect(row.reserved).toBeLessThanOrEqual(row.onHand);
  }, 15000);

  it('rolls back all writes when an unexpected error occurs mid-transaction', async () => {
    const org = await insertOrganization(db, 'Rollback Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'RB-1',
      name: 'Rollback Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 10,
    });

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(inventory)
          .set({ reserved: 5 })
          .where(eq(inventory.productId, product.id));
        const [order] = await tx
          .insert(orders)
          .values({ organizationId: org.id, status: 'pending' })
          .returning();
        expect(order).toBeDefined();
        throw new Error('injected mid-transaction failure');
      }),
    ).rejects.toThrow('injected mid-transaction failure');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(0);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(0);
  });
});
