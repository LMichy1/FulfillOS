import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../src/database/schema';
import { resolveTestDatabaseUrl } from '../../../scripts/lib/test-database-url';

export type TestDatabase = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: TestDatabase | undefined;

/** Lazily opens (once per test process) a connection pool to DATABASE_URL_TEST only. */
export function getTestDb(): TestDatabase {
  if (!db) {
    pool = new Pool({ connectionString: resolveTestDatabaseUrl() });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}

/**
 * Deletes every row from every domain table, in a single statement (Postgres resolves
 * TRUNCATE ... CASCADE ordering itself). Used between tests so each test starts from a known
 * empty state without paying the cost of re-running migrations per test.
 */
export async function truncateAll(database: TestDatabase): Promise<void> {
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
