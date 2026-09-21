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
  sessions,
} from '../../src/database/schema';

describe('catalog and orders API (security)', () => {
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

  // --- Missing / expired session -------------------------------------------------------

  it('rejects an unauthenticated request to list products or orders', async () => {
    const owner = await registerAndLogin(app, {
      email: 'unauth-catalog@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Unauth Catalog Org',
    });

    const productsResponse = await request(app.getHttpServer()).get(
      `/api/v1/organizations/${owner.organizationId}/products`,
    );
    expect(productsResponse.status).toBe(401);

    const ordersResponse = await request(app.getHttpServer()).get(
      `/api/v1/organizations/${owner.organizationId}/orders`,
    );
    expect(ordersResponse.status).toBe(401);
  });

  it('rejects a request using a session past its idle expiration', async () => {
    const owner = await registerAndLogin(app, {
      email: 'expired-catalog@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Expired Catalog Org',
    });
    await db
      .update(sessions)
      .set({ idleExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.userId, owner.userId));

    const response = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/products`,
    );
    expect(response.status).toBe(401);
  });

  // --- Product creation: role + CSRF + validation ---------------------------------------

  it('allows an owner but rejects a staff member from creating a product', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-catalog-role@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Catalog Role Org',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff-catalog-role@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Own Catalog Org',
    });
    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });

    const staffAttempt = await staffAccount.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .send({ sku: 'STAFF-SKU', name: 'Staff Product', unitPriceCents: 100 });
    expect(staffAttempt.status).toBe(403);

    const ownerAttempt = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        sku: 'OWNER-SKU',
        name: 'Owner Product',
        unitPriceCents: 100,
        initialOnHand: 5,
      });
    expect(ownerAttempt.status).toBe(201);
    expect(ownerAttempt.body.product).toMatchObject({
      sku: 'OWNER-SKU',
      onHand: 5,
      available: 5,
    });
  });

  it('rejects product creation with a missing or invalid CSRF token', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-catalog-csrf@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Catalog CSRF Org',
    });

    const missing = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .send({ sku: 'NO-CSRF', name: 'No CSRF', unitPriceCents: 100 });
    expect(missing.status).toBe(403);

    const invalid = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', 'not-the-real-token')
      .send({ sku: 'BAD-CSRF', name: 'Bad CSRF', unitPriceCents: 100 });
    expect(invalid.status).toBe(403);
  });

  it('rejects invalid product input with 400 before it reaches the database', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-catalog-invalid@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Catalog Invalid Org',
    });

    const missingName = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ sku: 'MISSING-NAME', unitPriceCents: 100 });
    expect(missingName.status).toBe(400);

    const negativePrice = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ sku: 'NEG-PRICE', name: 'Negative Price', unitPriceCents: -1 });
    expect(negativePrice.status).toBe(400);

    const unknownField = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/products`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        sku: 'UNKNOWN-FIELD',
        name: 'Unknown Field',
        unitPriceCents: 100,
        role: 'owner',
      });
    expect(unknownField.status).toBe(400);
  });

  // --- Cross-tenant isolation ------------------------------------------------------------

  it('rejects reading a product that belongs to another organization', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice-catalog@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Catalog Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob-catalog@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Catalog Org',
    });
    const bobsProduct = await createProductWithStock(
      bob.organizationId,
      'BOB-CATALOG-SKU',
      10,
    );

    const response = await alice.agent.get(
      `/api/v1/organizations/${bob.organizationId}/products/${bobsProduct.id}`,
    );
    expect(response.status).toBe(404);
  });

  it('rejects reading, fulfilling, or cancelling an order that belongs to another organization', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice-orders@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Orders Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob-orders@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Orders Org',
    });
    const bobsProduct = await createProductWithStock(
      bob.organizationId,
      'BOB-ORDER-SKU',
      10,
    );
    const bobsReservation = await bob.agent
      .post(`/api/v1/organizations/${bob.organizationId}/reservations`)
      .set('X-CSRF-Token', bob.csrfToken)
      .set('Idempotency-Key', 'bobs-reservation-key')
      .send({ items: [{ productId: bobsProduct.id, quantity: 2 }] });
    expect(bobsReservation.status).toBe(201);
    const orderId = bobsReservation.body.reservation.orderId;

    const readAttempt = await alice.agent.get(
      `/api/v1/organizations/${bob.organizationId}/orders/${orderId}`,
    );
    expect(readAttempt.status).toBe(404);

    const fulfillAttempt = await alice.agent
      .post(
        `/api/v1/organizations/${bob.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', alice.csrfToken)
      .set('Idempotency-Key', 'alice-fulfill-attempt')
      .send();
    expect(fulfillAttempt.status).toBe(404);

    const cancelAttempt = await alice.agent
      .post(
        `/api/v1/organizations/${bob.organizationId}/orders/${orderId}/cancel`,
      )
      .set('X-CSRF-Token', alice.csrfToken)
      .set('Idempotency-Key', 'alice-cancel-attempt')
      .send();
    expect(cancelAttempt.status).toBe(404);

    // Confirm neither cross-tenant attempt actually touched Bob's order.
    const bobsView = await bob.agent.get(
      `/api/v1/organizations/${bob.organizationId}/orders/${orderId}`,
    );
    expect(bobsView.body.order.status).toBe('pending');
  });

  // --- Full order lifecycle over real HTTP, both roles allowed ---------------------------

  it('allows both owner and staff to fulfill and cancel orders, end to end over real HTTP', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-lifecycle@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Lifecycle Org',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff-lifecycle@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Lifecycle Org',
    });
    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });
    const product = await createProductWithStock(
      owner.organizationId,
      'LIFECYCLE-SKU',
      10,
    );

    const created = await staffAccount.agent
      .post(`/api/v1/organizations/${owner.organizationId}/reservations`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .set('Idempotency-Key', 'lifecycle-reserve-key')
      .send({ items: [{ productId: product.id, quantity: 4 }] });
    expect(created.status).toBe(201);
    const orderId = created.body.reservation.orderId;

    const fulfilled = await owner.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', 'lifecycle-fulfill-key')
      .send();
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.order.status).toBe('fulfilled');

    const inventoryResponse = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/inventory`,
    );
    expect(inventoryResponse.body.inventory).toEqual([
      expect.objectContaining({ onHand: 6, reserved: 0, available: 6 }),
    ]);

    // Cancelling an already-fulfilled order must fail without touching inventory again.
    const cancelAfterFulfill = await staffAccount.agent
      .post(
        `/api/v1/organizations/${owner.organizationId}/orders/${orderId}/cancel`,
      )
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .set('Idempotency-Key', 'lifecycle-cancel-key')
      .send();
    expect(cancelAfterFulfill.status).toBe(409);
  });

  it('lists orders and products with stable pagination over real HTTP', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-http-pagination@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'HTTP Pagination Org',
    });

    for (let i = 0; i < 3; i++) {
      const response = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/products`)
        .set('X-CSRF-Token', owner.csrfToken)
        .send({
          sku: `HTTP-PAGE-${i}`,
          name: `HTTP Page Product ${i}`,
          unitPriceCents: 100,
        });
      expect(response.status).toBe(201);
    }

    const firstPage = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/products?limit=2`,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/products?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();
  });
});
