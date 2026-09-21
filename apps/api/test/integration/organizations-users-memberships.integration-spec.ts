import { organizations, memberships } from '../../src/database/schema';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization, insertUser } from './setup/fixtures';
import { expectPgErrorCode } from './setup/pg-error';

/** Postgres SQLSTATE codes — see https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';

describe('organizations, users, memberships (integration)', () => {
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

  it('rejects a duplicate organization id', async () => {
    const org = await insertOrganization(db, 'First Org');

    await expectPgErrorCode(
      db.insert(organizations).values({ id: org.id, name: 'Colliding Org' }),
      UNIQUE_VIOLATION,
    );
  });

  it('rejects a duplicate user email regardless of case or surrounding whitespace', async () => {
    await insertUser(db, {
      email: 'Person@Example.com',
      displayName: 'Person One',
    });

    await expectPgErrorCode(
      insertUser(db, {
        email: '  person@example.com  ',
        displayName: 'Person Two',
      }),
      UNIQUE_VIOLATION,
    );
  });

  it('allows the same email text in a case/whitespace variant to be inserted only once, and preserves the original raw email on the first row', async () => {
    const first = await insertUser(db, {
      email: 'Keep@Example.com',
      displayName: 'Original',
    });
    expect(first.email).toBe('Keep@Example.com');
    expect(first.emailNormalized).toBe('keep@example.com');
  });

  it('rejects a duplicate membership for the same user in the same organization', async () => {
    const org = await insertOrganization(db, 'Membership Org');
    const user = await insertUser(db, {
      email: 'member@example.com',
      displayName: 'Member Person',
    });

    await db.insert(memberships).values({
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
    });

    await expectPgErrorCode(
      db.insert(memberships).values({
        organizationId: org.id,
        userId: user.id,
        role: 'staff',
      }),
      UNIQUE_VIOLATION,
    );
  });

  it('allows the same user to belong to two different organizations', async () => {
    const orgA = await insertOrganization(db, 'Org A');
    const orgB = await insertOrganization(db, 'Org B');
    const user = await insertUser(db, {
      email: 'multi-org@example.com',
      displayName: 'Multi Org Person',
    });

    await db
      .insert(memberships)
      .values({ organizationId: orgA.id, userId: user.id, role: 'owner' });

    // Awaited directly (not wrapped in expect(...).resolves): if this insert rejects, the
    // async test function itself throws and the test fails — the same outcome, without the
    // ambiguity of applying `.toThrow()` to an already-resolved, non-function value.
    await db
      .insert(memberships)
      .values({ organizationId: orgB.id, userId: user.id, role: 'staff' });
  });
});
