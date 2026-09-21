import { eq } from 'drizzle-orm';
import {
  auditLog,
  inventory,
  inventoryMovements,
  orders,
  type Product,
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

describe('order fulfillment (integration)', () => {
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

  async function setUpReservation(
    orgName: string,
    items: Array<{ sku: string; onHand: number; quantity: number }>,
  ) {
    const org = await insertOrganization(db, orgName);
    const user = await insertUser(db, {
      email: `${orgName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
      displayName: orgName,
    });
    const products: Product[] = [];
    for (const item of items) {
      const product = await insertProduct(db, {
        organizationId: org.id,
        sku: item.sku,
        name: item.sku,
        unitPriceCents: 100,
      });
      await insertInventoryRow(db, {
        organizationId: org.id,
        productId: product.id,
        onHand: item.onHand,
      });
      products.push(product);
    }
    const reservation = await reservationsService.createReservation(
      org.id,
      user.id,
      {
        items: items.map((item, i) => ({
          productId: products[i].id,
          quantity: item.quantity,
        })),
      },
      `${orgName}-reserve-key`,
    );
    return { org, user, products, reservation };
  }

  it('fulfills a single-product order: on_hand and reserved both decrease, available unchanged', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Single Fulfill Org',
      [{ sku: 'SF-1', onHand: 10, quantity: 4 }],
    );

    const [before] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    const availableBefore = before.onHand - before.reserved;

    const fulfilled = await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'fulfill-key-1',
    );

    expect(fulfilled.status).toBe('fulfilled');
    expect(fulfilled.fulfilledAt).not.toBeNull();

    const [after] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    expect(after.onHand).toBe(6);
    expect(after.reserved).toBe(0);
    expect(after.onHand - after.reserved).toBe(availableBefore);
  });

  it('fulfills a multi-product order correctly for every line', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Multi Fulfill Org',
      [
        { sku: 'MF-A', onHand: 10, quantity: 3 },
        { sku: 'MF-B', onHand: 20, quantity: 7 },
      ],
    );

    await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'multi-fulfill-key',
    );

    const [rowA] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    const [rowB] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[1].id));
    expect(rowA).toMatchObject({ onHand: 7, reserved: 0 });
    expect(rowB).toMatchObject({ onHand: 13, reserved: 0 });
  });

  it('writes one fulfillment movement per line and one audit record', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Movement Fulfill Org',
      [
        { sku: 'MOVE-A', onHand: 10, quantity: 2 },
        { sku: 'MOVE-B', onHand: 10, quantity: 5 },
      ],
    );

    await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'movement-fulfill-key',
    );

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'fulfillment'));
    expect(movements).toHaveLength(2);
    const byProduct = new Map(movements.map((m) => [m.productId, m]));
    expect(byProduct.get(products[0].id)).toMatchObject({
      onHandDelta: -2,
      reservedDelta: -2,
    });
    expect(byProduct.get(products[1].id)).toMatchObject({
      onHandDelta: -5,
      reservedDelta: -5,
    });

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'order.fulfill'));
    expect(audits).toHaveLength(1);
    expect(audits[0].resourceId).toBe(reservation.orderId);
  });

  it('rejects fulfilling an order twice', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Double Fulfill Org',
      [{ sku: 'DF-1', onHand: 10, quantity: 4 }],
    );

    await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'double-fulfill-key-a',
    );

    await expect(
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'double-fulfill-key-b',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    expect(row.onHand).toBe(6);
    expect(row.reserved).toBe(0);
  });

  it('rejects fulfilling a cancelled order', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Cancelled Fulfill Org',
      [{ sku: 'CF-1', onHand: 10, quantity: 4 }],
    );

    await reservationsService.releaseReservation(
      org.id,
      user.id,
      reservation.orderId,
      'cancel-before-fulfill-key',
    );

    await expect(
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'fulfill-after-cancel-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    expect(row.onHand).toBe(10);
    expect(row.reserved).toBe(0);
  });

  it('rejects fulfilling a nonexistent order in this organization', async () => {
    const org = await insertOrganization(db, 'Missing Fulfill Org');
    const user = await insertUser(db, {
      email: 'missing-fulfill@example.com',
      displayName: 'Missing Fulfill',
    });

    await expect(
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        '00000000-0000-0000-0000-000000000000',
        'missing-fulfill-key',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('replays the original result for a retried fulfillment with the same key and payload', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Idempotent Fulfill Org',
      [{ sku: 'IF-1', onHand: 10, quantity: 4 }],
    );

    const first = await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'idempotent-fulfill-key',
    );
    const second = await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'idempotent-fulfill-key',
    );

    expect(second).toEqual(first);

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    // Consumed once, not twice — a second on_hand decrease of 4 would be 2, not 6.
    expect(row.onHand).toBe(6);
  });

  it('exactly one of two concurrent fulfillment attempts for the same order succeeds', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Concurrent Fulfill Org',
      [{ sku: 'CCF-1', onHand: 10, quantity: 4 }],
    );

    const [a, b] = await Promise.allSettled([
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'concurrent-fulfill-a',
      ),
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'concurrent-fulfill-b',
      ),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    // Fulfilled exactly once — not twice (which would be onHand=2), not zero times.
    expect(row.onHand).toBe(6);
    expect(row.reserved).toBe(0);
  }, 15000);

  it('resolves two concurrent identical fulfillment retries to the same single result', async () => {
    const { org, user, products, reservation } = await setUpReservation(
      'Concurrent Idempotent Fulfill Org',
      [{ sku: 'CIF-1', onHand: 10, quantity: 4 }],
    );

    const [a, b] = await Promise.allSettled([
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'same-fulfill-key',
      ),
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'same-fulfill-key',
      ),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    expect(row.onHand).toBe(6);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'fulfillment'));
    expect(movements).toHaveLength(1);
  }, 15000);

  it('rolls back all writes when an unexpected error occurs mid-fulfillment-transaction', async () => {
    const { products, reservation } = await setUpReservation(
      'Fulfill Rollback Org',
      [{ sku: 'FRB-1', onHand: 10, quantity: 4 }],
    );

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({ status: 'fulfilled', fulfilledAt: new Date() })
          .where(eq(orders.id, reservation.orderId));
        await tx
          .update(inventory)
          .set({ onHand: 6, reserved: 0 })
          .where(eq(inventory.productId, products[0].id));
        throw new Error('injected mid-fulfillment failure');
      }),
    ).rejects.toThrow('injected mid-fulfillment failure');

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, reservation.orderId));
    expect(order.status).toBe('pending');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, products[0].id));
    expect(row.onHand).toBe(10);
    expect(row.reserved).toBe(4);
  });
});
