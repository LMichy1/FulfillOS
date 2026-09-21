import { eq } from 'drizzle-orm';
import { inventory } from '../../src/database/schema';
import {
  DashboardService,
  LOW_STOCK_THRESHOLD,
} from '../../src/dashboard/dashboard.service';
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

describe('dashboard summary (integration)', () => {
  let db: TestDatabase;
  let dashboardService: DashboardService;
  let reservationsService: ReservationsService;

  beforeAll(async () => {
    db = await getTestDb();
    dashboardService = new DashboardService(db as unknown as Database);
    reservationsService = new ReservationsService(db as unknown as Database);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('returns all zeros for a brand-new organization with no products or orders', async () => {
    const org = await insertOrganization(db, 'Empty Dashboard Org');

    const summary = await dashboardService.getSummary(org.id);

    expect(summary).toEqual({
      totalProducts: 0,
      pendingOrders: 0,
      fulfilledOrders: 0,
      cancelledOrders: 0,
      lowStockProducts: 0,
    });
  });

  it('counts products, orders by status, and low-stock products correctly', async () => {
    const org = await insertOrganization(db, 'Populated Dashboard Org');
    const user = await insertUser(db, {
      email: 'dashboard-owner@example.com',
      displayName: 'Owner',
    });

    // Three products: one well-stocked, two at/under the low-stock threshold.
    const wellStocked = await insertProduct(db, {
      organizationId: org.id,
      sku: 'WELL-STOCKED',
      name: 'Well Stocked',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: wellStocked.id,
      onHand: LOW_STOCK_THRESHOLD + 50,
    });

    const lowStock = await insertProduct(db, {
      organizationId: org.id,
      sku: 'LOW-STOCK',
      name: 'Low Stock',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: lowStock.id,
      onHand: LOW_STOCK_THRESHOLD,
    });

    const outOfStock = await insertProduct(db, {
      organizationId: org.id,
      sku: 'OUT-OF-STOCK',
      name: 'Out Of Stock',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: org.id,
      productId: outOfStock.id,
      onHand: 0,
    });

    // One pending, one fulfilled, one cancelled order.
    const pendingReservation = await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: wellStocked.id, quantity: 1 }] },
      'dashboard-pending-key',
    );
    void pendingReservation;

    const toFulfill = await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: wellStocked.id, quantity: 1 }] },
      'dashboard-fulfill-key',
    );
    await reservationsService.fulfillOrder(
      org.id,
      user.id,
      toFulfill.orderId,
      'dashboard-fulfill-action-key',
    );

    const toCancel = await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: wellStocked.id, quantity: 1 }] },
      'dashboard-cancel-key',
    );
    await reservationsService.releaseReservation(
      org.id,
      user.id,
      toCancel.orderId,
      'dashboard-cancel-action-key',
    );

    const summary = await dashboardService.getSummary(org.id);

    expect(summary).toEqual({
      totalProducts: 3,
      pendingOrders: 1,
      fulfilledOrders: 1,
      cancelledOrders: 1,
      lowStockProducts: 2,
    });
  });

  it("never counts another organization's products or orders", async () => {
    const org = await insertOrganization(db, 'Isolated Org');
    const otherOrg = await insertOrganization(db, 'Other Dashboard Org');
    const otherProduct = await insertProduct(db, {
      organizationId: otherOrg.id,
      sku: 'OTHER-ORG-SKU',
      name: 'Other Org Product',
      unitPriceCents: 100,
    });
    await insertInventoryRow(db, {
      organizationId: otherOrg.id,
      productId: otherProduct.id,
      onHand: 0,
    });

    const summary = await dashboardService.getSummary(org.id);

    expect(summary).toEqual({
      totalProducts: 0,
      pendingOrders: 0,
      fulfilledOrders: 0,
      cancelledOrders: 0,
      lowStockProducts: 0,
    });

    // Confirm the fixture actually created the other org's row (i.e. this test would have
    // caught a leak, not just found nothing to leak).
    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.organizationId, otherOrg.id));
    expect(row).toBeDefined();
  });
});
