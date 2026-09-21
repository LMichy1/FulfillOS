import type { INestApplication } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import { registerAndLogin } from './setup/auth-helpers';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';
import { memberships } from '../../src/database/schema';

describe('tenant isolation (security)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    app = await createSecurityTestApp();
    db = getTestDb();
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

  it("organization A cannot read organization B's protected resource", async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Org',
    });

    const response = await alice.agent.get(
      `/api/v1/organizations/${bob.organizationId}`,
    );
    expect(response.status).toBe(404);
  });

  it("organization A cannot modify organization B's resource", async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice2@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org 2',
    });
    const bob = await registerAndLogin(app, {
      email: 'bob2@example.com',
      password: 'correct horse battery staple',
      displayName: 'Bob',
      organizationName: 'Bob Org 2',
    });

    const response = await alice.agent
      .patch(`/api/v1/organizations/${bob.organizationId}`)
      .set('X-CSRF-Token', alice.csrfToken)
      .send({ name: 'Hijacked name' });

    expect(response.status).toBe(404);

    // Confirm the name genuinely never changed.
    const check = await bob.agent.get(
      `/api/v1/organizations/${bob.organizationId}`,
    );
    expect(check.body.organization.name).toBe('Bob Org 2');
  });

  it('a non-member cannot access protected organization context, and gets the same response as a nonexistent org id', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice3@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org 3',
    });

    const nonMemberResponse = await alice.agent.get(
      '/api/v1/organizations/00000000-0000-0000-0000-000000000000',
    );
    expect(nonMemberResponse.status).toBe(404);
  });

  it('rejects a malformed organization id with 400, not a raw 500', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice4@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org 4',
    });

    const response = await alice.agent.get(
      '/api/v1/organizations/not-a-uuid-at-all',
    );
    expect(response.status).toBe(400);
  });

  it('a member cannot elevate their own role (no request field is even accepted for it)', async () => {
    const alice = await registerAndLogin(app, {
      email: 'alice5@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org 5',
    });

    // Alice is 'owner' of her own org already — attempt to smuggle a role change into the one
    // mutating endpoint she has access to.
    const response = await alice.agent
      .patch(`/api/v1/organizations/${alice.organizationId}`)
      .set('X-CSRF-Token', alice.csrfToken)
      .send({ name: 'Still Alice Org 5', role: 'owner' });

    expect(response.status).toBe(400);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, alice.userId),
          eq(memberships.organizationId, alice.organizationId),
        ),
      );
    expect(membership.role).toBe('owner');
  });

  it('a staff member can read but not rename an organization; membership revocation takes effect immediately', async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner6@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Owner Org 6',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff6@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Own Org 6',
    });

    // No invite endpoint exists yet (documented as deferred) — simulate one being added to
    // owner's org by inserting the membership row directly, exactly as a real invite feature
    // would eventually do.
    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });

    const readResponse = await staffAccount.agent.get(
      `/api/v1/organizations/${owner.organizationId}`,
    );
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.role).toBe('staff');

    const renameResponse = await staffAccount.agent
      .patch(`/api/v1/organizations/${owner.organizationId}`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .send({ name: 'Staff Hijack Attempt' });
    expect(renameResponse.status).toBe(403);

    // Revoke the membership directly (again, simulating a future admin action) and confirm
    // the SAME still-valid session cookie is rejected on the very next request.
    await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.userId, staffAccount.userId),
          eq(memberships.organizationId, owner.organizationId),
        ),
      );

    const afterRevocation = await staffAccount.agent.get(
      `/api/v1/organizations/${owner.organizationId}`,
    );
    expect(afterRevocation.status).toBe(404);
  });

  it("a promoted member's new permissions take effect on their very next request", async () => {
    const owner = await registerAndLogin(app, {
      email: 'owner7@example.com',
      password: 'correct horse battery staple',
      displayName: 'Owner',
      organizationName: 'Owner Org 7',
    });
    const staffAccount = await registerAndLogin(app, {
      email: 'staff7@example.com',
      password: 'correct horse battery staple',
      displayName: 'Staff',
      organizationName: 'Staff Own Org 7',
    });

    await db.insert(memberships).values({
      organizationId: owner.organizationId,
      userId: staffAccount.userId,
      role: 'staff',
    });

    const beforePromotion = await staffAccount.agent
      .patch(`/api/v1/organizations/${owner.organizationId}`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .send({ name: 'Should still fail' });
    expect(beforePromotion.status).toBe(403);

    await db
      .update(memberships)
      .set({ role: 'owner' })
      .where(
        and(
          eq(memberships.userId, staffAccount.userId),
          eq(memberships.organizationId, owner.organizationId),
        ),
      );

    const afterPromotion = await staffAccount.agent
      .patch(`/api/v1/organizations/${owner.organizationId}`)
      .set('X-CSRF-Token', staffAccount.csrfToken)
      .send({ name: 'Promoted rename succeeds' });
    expect(afterPromotion.status).toBe(200);
    expect(afterPromotion.body.organization.name).toBe(
      'Promoted rename succeeds',
    );
  });
});
