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

export function resolveTestDatabaseUrl(): string {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      'DATABASE_URL_TEST must be set to run integration tests or migrate the test database. ' +
        'Refusing to fall back to DATABASE_URL.',
    );
  }

  if (ORIGINAL_DATABASE_URL && testUrl === ORIGINAL_DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_TEST must not be the same value as DATABASE_URL — integration tests ' +
        'would run destructive operations against the development database.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error('DATABASE_URL_TEST is not a valid connection string.');
  }

  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run integration tests against database "${databaseName}": its name must ` +
        'contain "test", as a defense-in-depth check against a misconfigured DATABASE_URL_TEST ' +
        'accidentally pointing at a non-test database.',
    );
  }

  return testUrl;
}
