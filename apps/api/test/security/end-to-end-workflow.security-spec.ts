import type { INestApplication } from '@nestjs/common';
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
import { auditLog, inventoryMovements } from '../../src/database/schema';

/**
 * The complete business workflow from Milestone 4's brief, exercised entirely over real HTTP
 * against the real NestJS app and real PostgreSQL — no manual product insertion, no direct
 * database setup. Every step's response is asserted, not just the final state, so a
 * regression in an intermediate step fails at that step rather than surfacing as a confusing
 * failure two steps later.
 */
describe('end-to-end business workflow (security)', () => {
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

  it('registers, creates a product, reserves, fulfills, and verifies every step over real HTTP', async () => {
    // 1-2. Register a user and organization, and authenticate.
    const merchant = await registerAndLogin(app, {
      email: 'e2e-merchant@example.com',
      password: 'correct horse battery staple',
      displayName: 'Merchant',
      organizationName: 'E2E Workflow Org',
    });

    // 3-4. Create a product and initialize inventory (atomically, via the API).
    const createProductResponse = await merchant.agent
      .post(`/api/v1/organizations/${merchant.organizationId}/products`)
      .set('X-CSRF-Token', merchant.csrfToken)
      .send({
        sku: 'E2E-WIDGET',
        name: 'E2E Widget',
        description: 'A widget used in the end-to-end workflow test',
        unitPriceCents: 1500,
        initialOnHand: 20,
      });
    expect(createProductResponse.status).toBe(201);
    const product = createProductResponse.body.product;
    expect(product).toMatchObject({
      sku: 'E2E-WIDGET',
      onHand: 20,
      reserved: 0,
      available: 20,
    });

    // 5. Create an order using the reservation engine.
    const reserveResponse = await merchant.agent
      .post(`/api/v1/organizations/${merchant.organizationId}/reservations`)
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-reserve-key')
      .send({ items: [{ productId: product.id, quantity: 6 }] });
    expect(reserveResponse.status).toBe(201);
    expect(reserveResponse.body.reservation.status).toBe('pending');
    const orderId = reserveResponse.body.reservation.orderId;

    // 6. Verify available inventory decreases (reserved increases, on_hand unchanged).
    const inventoryAfterReserve = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/inventory`,
    );
    expect(inventoryAfterReserve.body.inventory).toEqual([
      expect.objectContaining({ onHand: 20, reserved: 6, available: 14 }),
    ]);

    // 7. Retrieve the order.
    const getOrderResponse = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}`,
    );
    expect(getOrderResponse.status).toBe(200);
    expect(getOrderResponse.body.order).toMatchObject({
      status: 'pending',
      items: [expect.objectContaining({ productId: product.id, quantity: 6 })],
    });

    // Order also appears in the organization's order listing.
    const listOrdersResponse = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/orders`,
    );
    expect(listOrdersResponse.body.items).toEqual([
      expect.objectContaining({ id: orderId, status: 'pending' }),
    ]);

    // 8. Fulfill the order.
    const fulfillResponse = await merchant.agent
      .post(
        `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-fulfill-key')
      .send();
    expect(fulfillResponse.status).toBe(200);

    // 9. Verify the fulfilled status.
    expect(fulfillResponse.body.order.status).toBe('fulfilled');
    expect(fulfillResponse.body.order.fulfilledAt).not.toBeNull();

    // 10. Verify on-hand and reserved quantities decrease correctly; available unchanged
    // from before fulfillment (consuming a reservation never frees or costs extra stock).
    const inventoryAfterFulfill = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/inventory`,
    );
    expect(inventoryAfterFulfill.body.inventory).toEqual([
      expect.objectContaining({ onHand: 14, reserved: 0, available: 14 }),
    ]);

    // 11. Verify movement and audit records.
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'fulfillment'));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      onHandDelta: -6,
      reservedDelta: -6,
    });

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'order.fulfill'));
    expect(audits).toHaveLength(1);
    expect(audits[0].resourceId).toBe(orderId);

    // 12. Retry fulfillment (same idempotency key) and verify no duplicate consumption.
    const retryFulfillResponse = await merchant.agent
      .post(
        `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-fulfill-key')
      .send();
    expect(retryFulfillResponse.status).toBe(200);
    expect(retryFulfillResponse.body.order.status).toBe('fulfilled');

    const inventoryAfterRetry = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/inventory`,
    );
    expect(inventoryAfterRetry.body.inventory).toEqual([
      expect.objectContaining({ onHand: 14, reserved: 0, available: 14 }),
    ]);
    const movementsAfterRetry = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'fulfillment'));
    expect(movementsAfterRetry).toHaveLength(1);

    // A retry with a genuinely new idempotency key against the now-fulfilled order must
    // still be rejected — a different key does not bypass the terminal-state protection.
    const freshKeyRetry = await merchant.agent
      .post(
        `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-fulfill-key-different')
      .send();
    expect(freshKeyRetry.status).toBe(409);
  });

  it('independently cancels a pending order, releasing its reservation, over real HTTP', async () => {
    const merchant = await registerAndLogin(app, {
      email: 'e2e-cancel-merchant@example.com',
      password: 'correct horse battery staple',
      displayName: 'Merchant',
      organizationName: 'E2E Cancel Org',
    });

    const createProductResponse = await merchant.agent
      .post(`/api/v1/organizations/${merchant.organizationId}/products`)
      .set('X-CSRF-Token', merchant.csrfToken)
      .send({
        sku: 'E2E-CANCEL-WIDGET',
        name: 'E2E Cancel Widget',
        unitPriceCents: 1000,
        initialOnHand: 10,
      });
    expect(createProductResponse.status).toBe(201);
    const product = createProductResponse.body.product;

    const reserveResponse = await merchant.agent
      .post(`/api/v1/organizations/${merchant.organizationId}/reservations`)
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-cancel-reserve-key')
      .send({ items: [{ productId: product.id, quantity: 4 }] });
    expect(reserveResponse.status).toBe(201);
    const orderId = reserveResponse.body.reservation.orderId;

    const cancelResponse = await merchant.agent
      .post(
        `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}/cancel`,
      )
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-cancel-key')
      .send();
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.order.status).toBe('cancelled');

    const inventoryAfterCancel = await merchant.agent.get(
      `/api/v1/organizations/${merchant.organizationId}/inventory`,
    );
    expect(inventoryAfterCancel.body.inventory).toEqual([
      expect.objectContaining({ onHand: 10, reserved: 0, available: 10 }),
    ]);

    // Fulfilling a cancelled order must be rejected.
    const fulfillAfterCancel = await merchant.agent
      .post(
        `/api/v1/organizations/${merchant.organizationId}/orders/${orderId}/fulfill`,
      )
      .set('X-CSRF-Token', merchant.csrfToken)
      .set('Idempotency-Key', 'e2e-fulfill-after-cancel-key')
      .send();
    expect(fulfillAfterCancel.status).toBe(409);
  });
});
