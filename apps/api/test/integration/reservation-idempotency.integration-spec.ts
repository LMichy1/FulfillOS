import { eq } from 'drizzle-orm';
import { orders } from '../../src/database/schema';
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

describe('reservations: transactional idempotency (integration)', () => {
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

  async function setUpProduct(orgName: string, onHand: number) {
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
    return { org, user, product };
  }

  it('replays the original result for a retried reservation with the same key and payload, without creating a second order', async () => {
    const { org, user, product } = await setUpProduct('Replay Org', 10);
    const dto = { items: [{ productId: product.id, quantity: 2 }] };

    const first = await reservationsService.createReservation(
      org.id,
      user.id,
      dto,
      'replay-key',
    );
    const second = await reservationsService.createReservation(
      org.id,
      user.id,
      dto,
      'replay-key',
    );

    expect(second.orderId).toBe(first.orderId);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(1);
  });

  it('rejects a reused idempotency key with a different payload, applying no effect', async () => {
    const { org, user, product } = await setUpProduct(
      'Conflict Payload Org',
      10,
    );

    await reservationsService.createReservation(
      org.id,
      user.id,
      { items: [{ productId: product.id, quantity: 2 }] },
      'conflict-key',
    );

    await expect(
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 3 }] },
        'conflict-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(1);
  });

  it('resolves two concurrent identical requests to the same single order', async () => {
    const { org, user, product } = await setUpProduct(
      'Concurrent Same Org',
      10,
    );
    const dto = { items: [{ productId: product.id, quantity: 2 }] };

    const [a, b] = await Promise.allSettled([
      reservationsService.createReservation(org.id, user.id, dto, 'same-key'),
      reservationsService.createReservation(org.id, user.id, dto, 'same-key'),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const orderIdA = (a as PromiseFulfilledResult<{ orderId: string }>).value
      .orderId;
    const orderIdB = (b as PromiseFulfilledResult<{ orderId: string }>).value
      .orderId;
    expect(orderIdA).toBe(orderIdB);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(1);
  }, 15000);

  it('resolves two concurrent conflicting-payload requests: one order, one rejection', async () => {
    const { org, user, product } = await setUpProduct(
      'Concurrent Conflict Org',
      10,
    );

    const [a, b] = await Promise.allSettled([
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 2 }] },
        'conflict-race-key',
      ),
      reservationsService.createReservation(
        org.id,
        user.id,
        { items: [{ productId: product.id, quantity: 4 }] },
        'conflict-race-key',
      ),
    ]);

    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
    });

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, org.id));
    expect(orderRows).toHaveLength(1);
  }, 15000);
});
