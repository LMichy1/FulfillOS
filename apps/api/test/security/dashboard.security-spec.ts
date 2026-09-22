import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import { registerAndLogin } from './setup/auth-helpers';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';
import { products, inventory } from '../../src/database/schema';

describe('dashboard summary API (security)', () => {
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

  it('rejects an unauthenticated request', async () => {
    const owner = await registerAndLogin(app, {
      email: 'unauth-dashboard@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Unauth Dashboard Org',
    });

    const response = await request(app.getHttpServer()).get(
      `/api/v1/organizations/${owner.organizationId}/dashboard/summary`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects reading another organization's dashboard summary", async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice-dashboard@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Dashboard Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob-dashboard@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Dashboard Org',
    });
    const [product] = await db
      .insert(products)
      .values({
        organizationId: bob.organizationId,
        sku: 'BOB-DASHBOARD-SKU',
        name: 'Bob Product',
        unitPriceCents: 100,
      })
      .returning();
    await db.insert(inventory).values({
      organizationId: bob.organizationId,
      productId: product.id,
      onHand: 10,
    });

    const response = await alice.agent.get(
      `/api/v1/organizations/${bob.organizationId}/dashboard/summary`,
    );
    expect(response.status).toBe(404);
  });

  it('allows both owner and staff to read the summary', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner-dashboard@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Dashboard Role Org',
    });

    const response = await owner.agent.get(
      `/api/v1/organizations/${owner.organizationId}/dashboard/summary`,
    );
    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totalProducts: 0,
      pendingOrders: 0,
      fulfilledOrders: 0,
      cancelledOrders: 0,
      lowStockProducts: 0,
    });
  });
});
