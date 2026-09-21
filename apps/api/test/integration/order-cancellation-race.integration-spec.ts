import { eq } from 'drizzle-orm';
import { inventory, orders } from '../../src/database/schema';
import { ReservationsService } from '../../src/reservations/reservations.service';
import { OrdersService } from '../../src/orders/orders.service';
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

describe('order fulfillment vs. cancellation race (integration)', () => {
  let db: TestDatabase;
  let reservationsService: ReservationsService;
  let ordersService: OrdersService;

  beforeAll(async () => {
    db = await getTestDb();
    reservationsService = new ReservationsService(db as unknown as Database);
    ordersService = new OrdersService(
      db as unknown as Database,
      reservationsService,
    );
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function setUpReservation(
    orgName: string,
    onHand: number,
    quantity: number,
  ) {
    const org = await insertOrganization(db, orgName);
    const user = await insertUser(db, {
      email: `${orgName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
      displayName: orgName,
    });
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: `${orgName.toUpperCase().replace(/\s+/g, '-')}-SKU`,
      name: orgName,
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand,
    });
    const reservation = await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: product.id, quantity }] },
      `${orgName}-create-key`,
    );
    return { org, user, product, reservation };
  }

  it('cancels a reservation via the /orders route delegation, identically to /reservations/:id/release', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Orders Cancel Org',
      10,
      4,
    );

    const cancelled = await ordersService.cancelOrder(
      org.id,
      user.id,
      reservation.orderId,
      'orders-cancel-key',
    );

    expect(cancelled.status).toBe('cancelled');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(0);
    expect(row.onHand).toBe(10);
  });

  it('fulfills a reservation via the /orders route delegation to the same ReservationsService method', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Orders Fulfill Org',
      10,
      4,
    );

    const fulfilled = await ordersService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'orders-fulfill-key',
    );

    expect(fulfilled.status).toBe('fulfilled');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(6);
    expect(row.reserved).toBe(0);
  });

  it('a concurrent fulfill-and-cancel race on the same pending order results in exactly one terminal transition', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Fulfill Cancel Race Org',
      10,
      4,
    );

    const [fulfillResult, cancelResult] = await Promise.allSettled([
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'race-fulfill-key',
      ),
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'race-cancel-key',
      ),
    ]);

    const outcomes = [fulfillResult, cancelResult];
    const fulfilledCount = outcomes.filter(
      (o) => o.status === 'fulfilled',
    ).length;
    const rejectedCount = outcomes.filter(
      (o) => o.status === 'rejected',
    ).length;
    // Exactly one of the two competing business transitions won — never both, never neither.
    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const rejected = outcomes.find(
      (o) => o.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, reservation.orderId));
    expect(['fulfilled', 'cancelled']).toContain(order.status);

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));

    // Inventory must reflect exactly one transition's effect, consistent with whichever the
    // order's final status says won — never a mix of both, never neither.
    if (order.status === 'fulfilled') {
      expect(row.onHand).toBe(6);
      expect(row.reserved).toBe(0);
    } else {
      expect(row.onHand).toBe(10);
      expect(row.reserved).toBe(0);
    }
  }, 15000);

  it('a fulfill-then-cancel sequential attempt on an already-fulfilled order is rejected without a second inventory change', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Sequential Fulfill Cancel Org',
      10,
      4,
    );

    await reservationsService.fulfillOrder(
      org.id,
      user.id,
      reservation.orderId,
      'sequential-fulfill-key',
    );

    await expect(
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'sequential-cancel-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(6);
    expect(row.reserved).toBe(0);
  });

  it('a cancel-then-fulfill sequential attempt on an already-cancelled order is rejected without touching inventory', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Sequential Cancel Fulfill Org',
      10,
      4,
    );

    await reservationsService.releaseReservation(
      org.id,
      user.id,
      reservation.orderId,
      'sequential-cancel-first-key',
    );

    await expect(
      reservationsService.fulfillOrder(
        org.id,
        user.id,
        reservation.orderId,
        'sequential-fulfill-second-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(10);
    expect(row.reserved).toBe(0);
  });
});
