import { randomUUID } from 'node:crypto';
import {
  orders,
  orderItems,
  products,
  idempotencyKeys,
} from '../../src/database/schema';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization } from './setup/fixtures';
import { expectPgErrorCode } from './setup/pg-error';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

describe('orders and idempotency (integration)', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('rejects an order item referencing a product from a different organization than its order', async () => {
    const orderOrg = await insertOrganization(db, 'Order Org');
    const productOrg = await insertOrganization(db, 'Product Org');

    const [order] = await db
      .insert(orders)
      .values({ organizationId: orderOrg.id })
      .returning();
    const [product] = await db
      .insert(products)
      .values({
        organizationId: productOrg.id,
        sku: 'FOREIGN-PRODUCT',
        name: 'Foreign Product',
        unitPriceCents: 500,
      })
      .returning();

    await expectPgErrorCode(
      db.insert(orderItems).values({
        organizationId: orderOrg.id,
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        unitPriceCents: 500,
      }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('rejects an order item whose (order_id, organization_id) pair does not match any real order', async () => {
    const org = await insertOrganization(db, 'Invalid FK Org');
    const [product] = await db
      .insert(products)
      .values({
        organizationId: org.id,
        sku: 'REAL-PRODUCT',
        name: 'Real Product',
        unitPriceCents: 500,
      })
      .returning();

    await expectPgErrorCode(
      db.insert(orderItems).values({
        organizationId: org.id,
        orderId: randomUUID(), // no order with this id exists at all
        productId: product.id,
        quantity: 1,
        unitPriceCents: 500,
      }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('rejects an order referencing a non-existent organization', async () => {
    await expectPgErrorCode(
      db.insert(orders).values({ organizationId: randomUUID() }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('rejects a duplicate idempotency key for the same organization and operation', async () => {
    const org = await insertOrganization(db, 'Idempotency Org');

    await db.insert(idempotencyKeys).values({
      organizationId: org.id,
      operation: 'order.create',
      idempotencyKey: 'client-key-1',
      requestFingerprint: 'fingerprint-a',
    });

    await expectPgErrorCode(
      db.insert(idempotencyKeys).values({
        organizationId: org.id,
        operation: 'order.create',
        idempotencyKey: 'client-key-1',
        requestFingerprint: 'fingerprint-b', // different payload, same key — still rejected
      }),
      UNIQUE_VIOLATION,
    );
  });

  it('allows the same idempotency key to be reused for a different operation, or by a different organization', async () => {
    const orgA = await insertOrganization(db, 'Idempotency Org A');
    const orgB = await insertOrganization(db, 'Idempotency Org B');

    await db.insert(idempotencyKeys).values({
      organizationId: orgA.id,
      operation: 'order.create',
      idempotencyKey: 'shared-key',
      requestFingerprint: 'fingerprint-a',
    });

    await db.insert(idempotencyKeys).values({
      organizationId: orgA.id,
      operation: 'order.cancel', // different operation, same org + key
      idempotencyKey: 'shared-key',
      requestFingerprint: 'fingerprint-c',
    });

    await db.insert(idempotencyKeys).values({
      organizationId: orgB.id, // different org, same operation + key
      operation: 'order.create',
      idempotencyKey: 'shared-key',
      requestFingerprint: 'fingerprint-d',
    });
  });

  it('rejects marking an idempotency key completed without a response status', async () => {
    const org = await insertOrganization(db, 'Incomplete Response Org');

    await expectPgErrorCode(
      db.insert(idempotencyKeys).values({
        organizationId: org.id,
        operation: 'order.create',
        idempotencyKey: 'no-response-key',
        requestFingerprint: 'fingerprint-e',
        state: 'completed',
        // responseStatus intentionally omitted
      }),
      CHECK_VIOLATION,
    );
  });
});
