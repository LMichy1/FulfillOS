import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../src/database/schema';
import {
  resolveTestDatabaseUrl,
  assertConnectedToTestDatabase,
} from '../../../scripts/lib/test-database-url';

export type TestDatabase = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: TestDatabase | undefined;
let resolvedTestUrl: string | undefined;

/** Lazily opens (once per test process) a connection pool to DATABASE_URL_TEST only, and
 * verifies — via a live round trip, not just the connection string — that it actually landed
 * on the expected test database before handing it out. */
export async function getTestDb(): Promise<TestDatabase> {
  if (!db) {
    resolvedTestUrl = resolveTestDatabaseUrl();
    pool = new Pool({ connectionString: resolvedTestUrl });
    await assertConnectedToTestDatabase(pool, resolvedTestUrl);
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
    resolvedTestUrl = undefined;
  }
}

/**
 * Deletes every row from every domain table, in a single statement (Postgres resolves
 * TRUNCATE ... CASCADE ordering itself). Used between tests so each test starts from a known
 * empty state without paying the cost of re-running migrations per test.
 *
 * Re-verifies database identity immediately before truncating, every single call — not just
 * once when the pool was opened. This is deliberately not an optimization shortcut: "checked
 * once, trusted for the rest of the process" is exactly the failure mode a prior milestone's
 * test harness fell into (see docs/architecture/authentication.md's known limitations and
 * the Milestone 3 checkpoint report for the incident this guards against).
 */
export async function truncateAll(database: TestDatabase): Promise<void> {
  if (!pool || !resolvedTestUrl) {
    throw new Error(
      'truncateAll() called before getTestDb() established a verified connection.',
    );
  }
  await assertConnectedToTestDatabase(pool, resolvedTestUrl);

  await database.execute(sql`
    TRUNCATE TABLE
      audit_log,
      idempotency_keys,
      order_items,
      orders,
      inventory_movements,
      inventory,
      products,
      sessions,
      memberships,
      users,
      organizations
    RESTART IDENTITY CASCADE
  `);
}
