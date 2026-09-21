import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import { registerUser } from './setup/auth-helpers';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';
import { organizations, memberships } from '../../src/database/schema';

describe('registration bootstrap (security)', () => {
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

  it('has no request field that could target an existing organization — registration always creates a brand-new one', async () => {
    const first = await registerUser(app, {
      email: 'first@example.com',
      password: 'correct horse battery staple',
      displayName: 'First',
      organizationName: 'Shared Org Name',
    });
    const second = await registerUser(app, {
      email: 'second@example.com',
      password: 'correct horse battery staple',
      displayName: 'Second',
      organizationName: 'Shared Org Name',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Same organization *name* is not the same organization: two distinct ids, two distinct
    // owner memberships, even though nothing in the request could express "join an existing
    // organization" to begin with.
    expect(first.body.organizationId).not.toBe(second.body.organizationId);

    const [firstMembership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, first.body.organizationId));
    const [secondMembership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, second.body.organizationId));
    expect(firstMembership.role).toBe('owner');
    expect(secondMembership.role).toBe('owner');
    expect(firstMembership.userId).not.toBe(secondMembership.userId);
  });

  it('rolls back the entire bootstrap transaction when registration fails partway (no orphan organization)', async () => {
    const input = {
      email: 'rollback-test@example.com',
      password: 'correct horse battery staple',
      displayName: 'Rollback First',
      organizationName: 'Rollback First Org',
    };
    const first = await registerUser(app, input);
    expect(first.status).toBe(201);

    // Same email again, but with a different organization name this time — if the
    // implementation created the organization row before discovering the user-insert
    // conflicts on email, an orphan organization would be left behind without failing the
    // whole request.
    const second = await registerUser(app, {
      ...input,
      organizationName: 'Rollback Second Org (should never exist)',
    });
    expect(second.status).toBe(409);

    const orphan = await db
      .select()
      .from(organizations)
      .where(
        eq(organizations.name, 'Rollback Second Org (should never exist)'),
      );
    expect(orphan).toHaveLength(0);

    const allOrgs = await db.select().from(organizations);
    expect(allOrgs).toHaveLength(1);
    expect(allOrgs[0].name).toBe('Rollback First Org');
  });
});
