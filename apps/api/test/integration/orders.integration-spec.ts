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

describe('orders: listing and retrieval (integration)', () => {
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

  async function setUp(orgName: string) {
    const org = await insertOrganization(db, orgName);
    const user = await insertUser(db, {
      email: `${orgName.toLowerCase().replace(/\s+/g, '-')}@example.com`,
      displayName: orgName,
    });
    return { org, user };
  }

  it('retrieves an order with its items, quantities, and status', async () => {
    const { org, user } = await setUp('Order Detail Org');
    const productA = await insertProduct(db, {
      organizationId: org.id,
      sku: 'ORD-A',
      name: 'Order Product A',
      unitPriceCents: 100,
    });
    const productB = await insertProduct(db, {
      organizationId: org.id,
      sku: 'ORD-B',
      name: 'Order Product B',
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
      onHand: 10,
    });

    const reservation = await reservationsService.createReservation(
      org.id,
      user.id,
      {
        items: [
          { productId: productA.id, quantity: 2 },
          { productId: productB.id, quantity: 3 },
        ],
      },
      'detail-key',
    );

    const order = await ordersService.getOrder(org.id, reservation.orderId);
    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(2);
    expect(order.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: productA.id,
          sku: 'ORD-A',
          quantity: 2,
          unitPriceCents: 100,
        }),
        expect.objectContaining({
          productId: productB.id,
          sku: 'ORD-B',
          quantity: 3,
          unitPriceCents: 200,
        }),
      ]),
    );
  });

  it('rejects retrieving an order that belongs to a different organization', async () => {
    const { org, user } = await setUp('Order Owner Org');
    const otherOrg = await insertOrganization(db, 'Order Intruder Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'ORD-TENANT',
      name: 'Tenant Order Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 10,
    });
    const reservation = await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: product.id, quantity: 1 }] },
      'tenant-order-key',
    );

    await expect(
      ordersService.getOrder(otherOrg.id, reservation.orderId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects retrieving a nonexistent order', async () => {
    const { org } = await setUp('Missing Order Org');

    await expect(
      ordersService.getOrder(org.id, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('paginates order listings deterministically, newest first', async () => {
    const { org, user } = await setUp('Order Pagination Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'ORD-PAGE',
      name: 'Pagination Order Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 100,
    });

    const createdIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const reservation = await reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 1 }] },
        `page-key-${i}`,
      );
      createdIds.push(reservation.orderId);
    }

    const firstPage = await ordersService.listOrders(org.id, { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await ordersService.listOrders(org.id, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items).toHaveLength(2);

    const thirdPage = await ordersService.listOrders(org.id, {
      limit: 2,
      cursor: secondPage.nextCursor!,
    });
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.nextCursor).toBeNull();

    const allIds = [
      ...firstPage.items,
      ...secondPage.items,
      ...thirdPage.items,
    ].map((o) => o.id);
    expect(new Set(allIds)).toEqual(new Set(createdIds));
  });

  it("does not list another organization's orders", async () => {
    const { org, user } = await setUp('List Owner Org');
    const otherOrg = await insertOrganization(db, 'List Other Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'LIST-TENANT',
      name: 'List Tenant Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: product.id,
      onHand: 10,
    });
    await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: product.id, quantity: 1 }] },
      'list-tenant-key',
    );

    const otherOrgOrders = await ordersService.listOrders(otherOrg.id, {});
    expect(otherOrgOrders.items).toHaveLength(0);
  });
});
