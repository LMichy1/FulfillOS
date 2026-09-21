import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import { registerAndLogin } from './setup/auth-helpers';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';
import {
  memberships,
  products,
  inventory,
  orders,
} from '../../src/database/schema';

describe('inventory and reservations API (security)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    app = await createSecurityTestApp();
    db = await getTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    await flushTestRedis();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
    await closeTestRedis();
  });

  async function createProductWithStock(
    organizationId: string,
    sku: string,
    onHand: number,
  ) {
    const [product] = await db
      .insert(products)
      .values({ organizationId, sku, name: sku, unitPriceCents: 100 })
      .returning();
    await db
      .insert(inventory)
      .values({ organizationId, productId: product.id, onHand });
    return product;
  }

  it('rejects an unauthenticated request to read inventory', async () => {
    const owner = await registerAndLogin(app, {
      email: 'unauth-owner@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Unauth Org',
    });

    const response = await request(app.getHttpServer()).get(
      `/api/v1/organizations/${owner.organizationId}/inventory`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects reading another organization's inventory", async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice-inv@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Inventory Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob-inv@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Inventory Org',
    });
    await createProductWithStock(bob.organizationId, 'BOB-SKU', 10);

    const response = await alice.agent.get(
      `/api/v1/organizations/${bob.organizationId}/inventory`,
    );
    expect(response.status).toBe(404);
  });

  it('allows an owner to read and adjust inventory, end to end over real HTTP', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-inv@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Owner Inventory Org',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'OWNER-SKU',
      5,
    );

    const listResponse = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/inventory`,
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.inventory).toEqual([
      expect.objectContaining({
        productId: product.id,
        onHand: 5,
        reserved: 0,
        available: 5,
      }),
    ]);

    const adjustResponse = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'http-adjust-key-1')
      .send({ productId: product.id, delta: 5, reason: 'restock' });
    expect(adjustResponse.status).toBe(200);
    expect(adjustResponse.body.inventory).toMatchObject({
      onHand: 10,
      available: 10,
    });
  });

  it('rejects a staff member adjusting inventory, but allows the owner', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-role@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Role Org',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff-role@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Own Org',
    });
    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'ROLE-SKU',
      10,
    );

    const staffAttempt = await staffAccount.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .set('Idempotency-Key', 'staff-adjust-key')
      .send({ productId: product.id, delta: 5, reason: 'restock' });
    expect(staffAttempt.status).toBe(403);

    const ownerAttempt = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'owner-adjust-key')
      .send({ productId: product.id, delta: 5, reason: 'restock' });
    expect(ownerAttempt.status).toBe(200);
  });

  it('rejects an inventory adjustment with a missing or invalid CSRF token', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-csrf@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'CSRF Org',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'CSRF-SKU',
      10,
    );

    const missing = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('Idempotency-Key', 'csrf-missing-key')
      .send({ productId: product.id, delta: 1, reason: 'x' });
    expect(missing.status).toBe(403);

    const invalid = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('X-CSRF-Token', 'not-the-real-token')
      .set('Idempotency-Key', 'csrf-invalid-key')
      .send({ productId: product.id, delta: 1, reason: 'x' });
    expect(invalid.status).toBe(403);
  });

  it('rejects a mutating inventory/reservation request with a missing Idempotency-Key header', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-idem@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Idem Org',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'IDEM-SKU',
      10,
    );

    const response = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/inventory/adjustments`,
      )
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ productId: product.id, delta: 1, reason: 'x' });
    expect(response.status).toBe(400);
  });

  it('allows both owner and staff to create and release reservations, end to end over real HTTP', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-reserve@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Reserve Org',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff-reserve@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Reserve Org',
    });
    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'RESERVE-SKU',
      10,
    );

    const createResponse = await staffAccount.agent
      .post(`/api/v1/organizations/${owner.organizationId}/reservations`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .set('Idempotency-Key', 'http-reserve-key')
      .send({ items: [{ productId: product.id, quantity: 4 }] });
    expect(createResponse.status).toBe(201);
    const orderId = createResponse.body.reservation.orderId;
    expect(createResponse.body.reservation.status).toBe('pending');

    const releaseResponse = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/reservations/${orderId}/release`,
      )
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'http-release-key')
      .send();
    expect(releaseResponse.status).toBe(200);
    expect(releaseResponse.body.reservation.status).toBe('cancelled');

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.reserved).toBe(0);
  });

  it('replays the same result for a retried reservation request with the same Idempotency-Key', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-replay@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Replay Org',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'REPLAY-SKU',
      10,
    );
    const body = { items: [{ productId: product.id, quantity: 2 }] };

    const first = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/reservations`)
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'http-replay-key')
      .send(body);
    const second = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/reservations`)
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'http-replay-key')
      .send(body);

    expect(second.body.reservation.orderId).toBe(
      first.body.reservation.orderId,
    );

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, owner.organizationId));
    expect(orderRows).toHaveLength(1);
  });

  it('rejects a reservation for a product belonging to another organization', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice-reserve@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Reserve Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob-reserve@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Reserve Org',
    });
    const bobsProduct = await createProductWithStock(
      bob.organizationId,
      'BOB-RESERVE-SKU',
      10,
    );

    const response = await alice.agent
      .post(`/api/v1/organizations/${alice.organizationId}/reservations`)
      .set('X-CSRF-Token', alice.csrfToken)
      .set('Idempotency-Key', 'cross-tenant-reserve-key')
      .send({ items: [{ productId: bobsProduct.id, quantity: 1 }] });
    expect(response.status).toBe(400);
  });
});
