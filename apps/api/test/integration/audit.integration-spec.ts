import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auditLog, users } from '../../src/database/schema';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization, insertUser } from './setup/fixtures';
import { expectPgErrorCode } from './setup/pg-error';

const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';

describe('audit log (integration)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await getTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('requires an organization on every audit record', async () => {
    await expectPgErrorCode(
      db.insert(auditLog).values({
        // organizationId intentionally omitted
        action: 'product.created',
        resourceType: 'product',
        resourceId: randomUUID(),
      } as never),
      NOT_NULL_VIOLATION,
    );
  });

  it('rejects an audit record for a non-existent organization', async () => {
    await expectPgErrorCode(
      db.insert(auditLog).values({
        organizationId: randomUUID(),
        action: 'product.created',
        resourceType: 'product',
        resourceId: randomUUID(),
      }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('allows an audit record with no actor (a system action)', async () => {
    const org = await insertOrganization(db, 'Audit Org');

    await db.insert(auditLog).values({
      organizationId: org.id,
      actorUserId: null,
      action: 'inventory.adjusted',
      resourceType: 'inventory',
      resourceId: randomUUID(),
    });
  });

  it('keeps an audit record after its actor user is deleted, with actor set to null', async () => {
    const org = await insertOrganization(db, 'Audit Survivor Org');
    const actor = await insertUser(db, {
      email: 'actor@example.com',
      displayName: 'Actor',
    });
    const resourceId = randomUUID();

    await db.insert(auditLog).values({
      organizationId: org.id,
      actorUserId: actor.id,
      action: 'order.cancelled',
      resourceType: 'order',
      resourceId,
    });

    await db.delete(users).where(eq(users.id, actor.id));

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resourceId, resourceId));

    expect(entry).toBeDefined();
    expect(entry.actorUserId).toBeNull();
  });
});
