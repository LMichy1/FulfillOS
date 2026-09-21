import type { Pool } from 'pg';

/**
 * Resolves and safety-checks the database URL integration tests and the test-migration
 * script are allowed to touch. Used by both scripts/migrate-test.ts and the integration test
 * harness so there is exactly one place this guard is implemented.
 *
 * Guards against the single most damaging mistake here: accidentally running destructive
 * test setup (TRUNCATE, migrations) against the development or production database.
 *
 * Captured once, at module load time — before test/security/setup/app.ts (which needs the
 * whole app, including its DatabaseModule, to connect to the test database) deliberately
 * overwrites process.env.DATABASE_URL to point at the test database for the rest of the
 * process's lifetime. Without this snapshot, a second call to this function later in the
 * same test file would compare DATABASE_URL_TEST against the value *this function itself*
 * wrote into DATABASE_URL, always "matching" and always throwing — the point of the check is
 * to catch a real developer misconfiguration, not this module's own intentional override.
 */
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

/** Postgres database names this project uses for real (non-test) data — checked against
 * even when DATABASE_URL isn't set in the current process at all (e.g. a CI step that only
 * sets DATABASE_URL_TEST), where the string-equality check below has nothing to compare
 * against. Kept in sync with .env.example / docker-compose.yml. */
const KNOWN_NON_TEST_DATABASE_NAMES = new Set([
  'fulfillos',
  'postgres',
  'template0',
  'template1',
]);

/** True if two Postgres connection strings address the same (host, port, database) —
 * a stricter check than raw string equality, which would miss e.g. an explicit default port
 * or a hostname alias pointing at the same server. Credentials and query params are
 * deliberately ignored: two URLs with different users but the same host/port/db still count
 * as "the same database" for this check's purpose. */
function sameDatabaseTarget(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const portA = ua.port || '5432';
    const portB = ub.port || '5432';
    return (
      ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
      portA === portB &&
      ua.pathname === ub.pathname
    );
  } catch {
    // If either URL fails to parse, fall back to exact string comparison rather than
    // silently treating unparseable input as "different" (and therefore safe).
    return a === b;
  }
}

function extractDatabaseName(connectionString: string): string {
  const parsed = new URL(connectionString);
  return parsed.pathname.replace(/^\//, '');
}

export function resolveTestDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to resolve a test database URL with NODE_ENV=production. Test scripts and ' +
        'integration/security test suites must never run against a production environment.',
    );
  }

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      'DATABASE_URL_TEST must be set to run integration tests or migrate the test database. ' +
        'Refusing to fall back to DATABASE_URL.',
    );
  }

  if (
    ORIGINAL_DATABASE_URL &&
    sameDatabaseTarget(testUrl, ORIGINAL_DATABASE_URL)
  ) {
    throw new Error(
      'DATABASE_URL_TEST resolves to the same host/port/database as DATABASE_URL — ' +
        'integration tests would run destructive operations against the development database.',
    );
  }

  let databaseName: string;
  try {
    databaseName = extractDatabaseName(testUrl);
  } catch {
    throw new Error('DATABASE_URL_TEST is not a valid connection string.');
  }

  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run integration tests against database "${databaseName}": its name must ` +
        'contain "test", as a defense-in-depth check against a misconfigured DATABASE_URL_TEST ' +
        'accidentally pointing at a non-test database.',
    );
  }

  if (KNOWN_NON_TEST_DATABASE_NAMES.has(databaseName.toLowerCase())) {
    throw new Error(
      `Refusing to run integration tests against database "${databaseName}": it is a known ` +
        'non-test database name for this project.',
    );
  }

  return testUrl;
}

/**
 * Live identity check: queries the actual connected Postgres server for the database it
 * thinks it's in (`current_database()`) and the expected name parsed from the connection
 * string the pool was created with, and throws immediately on any mismatch.
 *
 * This closes the gap a purely string-based check (resolveTestDatabaseUrl above) can't: it
 * verifies what the live TCP connection actually landed on, not just what the connection
 * string *said* it should be — catching cases like a stale pooled connection, a proxy or
 * connection string alias that silently redirects, or a typo'd port that happens to also be
 * running Postgres. Called once when a pool is created AND again immediately before every
 * destructive operation (TRUNCATE) — cheap (one round trip) and non-optional, precisely
 * because "checked once at startup, trusted forever after" is the exact failure mode this
 * milestone's preflight was asked to close.
 */
export async function assertConnectedToTestDatabase(
  pool: Pool,
  expectedConnectionString: string,
): Promise<void> {
  const expectedName = extractDatabaseName(expectedConnectionString);
  const result = await pool.query<{ current_database: string }>(
    'SELECT current_database()',
  );
  const actualName = result.rows[0]?.current_database;

  if (actualName !== expectedName) {
    throw new Error(
      `Refusing to proceed: connected to database "${actualName}", but expected "${expectedName}" ` +
        '(from DATABASE_URL_TEST). This connection will not be used for any destructive operation.',
    );
  }

  if (!actualName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to proceed: connected database "${actualName}" does not contain "test" in its name.`,
    );
  }

  if (KNOWN_NON_TEST_DATABASE_NAMES.has(actualName.toLowerCase())) {
    throw new Error(
      `Refusing to proceed: connected database "${actualName}" is a known non-test database name.`,
    );
  }
}
