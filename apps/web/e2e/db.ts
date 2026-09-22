// Direct database access for E2E setup steps the UI has no route for yet (adding a second
// organization's membership — there is no invitation flow; see
// docs/architecture/frontend.md#known-limitations). Scoped to the same isolated test database
// every other part of this suite uses (see playwright.config.ts, e2e/global-setup.ts) and
// re-checks that explicitly before running anything, rather than trusting the environment.
import path from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL_TEST;
    if (!url) {
      throw new Error('DATABASE_URL_TEST must be set for E2E database setup helpers.');
    }
    const databaseName = new URL(url).pathname.replace(/^\//, '');
    if (!databaseName.toLowerCase().includes('test')) {
      throw new Error(
        `Refusing to use a database without "test" in its name for E2E setup: ${databaseName}`,
      );
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/** Adds `email` as a `staff` member of the most recently created organization named
 * `organizationName` — the direct-DB equivalent of an invitation flow that doesn't exist yet. */
export async function addStaffMembership(email: string, organizationName: string): Promise<void> {
  const db = getPool();
  const { rows: userRows } = await db.query(
    'SELECT id FROM users WHERE email_normalized = lower(btrim($1))',
    [email],
  );
  const { rows: orgRows } = await db.query(
    'SELECT id FROM organizations WHERE name = $1 ORDER BY created_at DESC LIMIT 1',
    [organizationName],
  );
  if (!userRows[0]) {
    throw new Error(`addStaffMembership: no user found for email ${email}`);
  }
  if (!orgRows[0]) {
    throw new Error(`addStaffMembership: no organization found named ${organizationName}`);
  }
  await db.query(
    'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [orgRows[0].id, userRows[0].id, 'staff'],
  );
}

/** Expires every active session for `email` immediately — the direct-DB equivalent of waiting
 * out the real idle timeout, used only to test the frontend's handling of an already-expired
 * session (see docs/architecture/authentication.md for the real expiration mechanism this
 * short-circuits, not replaces). */
export async function expireSession(email: string): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE sessions
     SET idle_expires_at = now() - interval '1 minute'
     WHERE user_id = (SELECT id FROM users WHERE email_normalized = lower(btrim($1)))`,
    [email],
  );
}

export async function closeE2eDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
