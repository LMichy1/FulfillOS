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

describe('reservations: release and cancellation (integration)', () => {
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

  it('releases a pending reservation, decrementing reserved and marking cancelled', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Release Org',
      10,
      3,
    );

    const released = await reservationsService.releaseReservation(
      org.id,
      user.id,
      reservation.orderId,
      'release-key-1',
    );

    expect(released.status).toBe('cancelled');
    expect(released.cancelledAt).not.toBeNull();

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(0);
    expect(row.onHand).toBe(10);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'release'));
    expect(movements).toHaveLength(1);
    expect(movements[0].reservedDelta).toBe(-3);
  });

  it('rejects releasing an already-cancelled reservation (sequential double release)', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Double Release Org',
      10,
      3,
    );

    await reservationsService.releaseReservation(
      org.id,
      user.id,
      reservation.orderId,
      'release-key-a',
    );

    await expect(
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'release-key-b',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(0);
  });

  it('exactly one of two concurrent release requests for the same reservation succeeds', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Concurrent Release Org',
      10,
      3,
    );

    const [a, b] = await Promise.allSettled([
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'concurrent-release-a',
      ),
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'concurrent-release-b',
      ),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    // Released exactly once — never negative, never double-credited.
    expect(row.reserved).toBe(0);
  }, 15000);

  it('rejects releasing a reservation that does not exist in this organization', async () => {
    const org = await insertOrganization(db, 'No Reservation Org');
    const user = await insertUser(db, {
      email: 'no-reservation@example.com',
      displayName: 'No Reservation',
    });

    await expect(
      reservationsService.releaseReservation(
        org.id,
        user.id,
        '00000000-0000-0000-0000-000000000000',
        'missing-key',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects releasing a reservation that belongs to a different organization', async () => {
    const { reservation } = await setUpReservation('Owner Org', 10, 2);
    const otherOrg = await insertOrganization(db, 'Intruder Org');
    const otherUser = await insertUser(db, {
      email: 'intruder@example.com',
      displayName: 'Intruder',
    });

    await expect(
      reservationsService.releaseReservation(
        otherOrg.id,
        otherUser.id,
        reservation.orderId,
        'intruder-key',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects releasing a reservation that is already fulfilled', async () => {
    const { org, user, product, reservation } = await setUpReservation(
      'Fulfilled Org',
      10,
      2,
    );
    // No fulfillment workflow exists yet (deferred to a future milestone) — simulate the
    // terminal state directly to exercise the non-`pending` rejection branch.
    await db
      .update(orders)
      .set({ status: 'fulfilled' })
      .where(eq(orders.id, reservation.orderId));

    await expect(
      reservationsService.releaseReservation(
        org.id,
        user.id,
        reservation.orderId,
        'fulfilled-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(2);
  });
});
