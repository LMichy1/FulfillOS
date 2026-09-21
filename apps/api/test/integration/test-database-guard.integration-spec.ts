import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Regression tests for the test-database identity guard itself
 * (scripts/lib/test-database-url.ts). These exist because the guard is the last line of
 * defense against destructive test operations landing on the development database — a defect
 * here is exactly as dangerous as the misconfiguration it's supposed to catch.
 *
 * Each `resolveTestDatabaseUrl` scenario reloads the module after mutating process.env, since
 * the module captures DATABASE_URL once at load time (see its own comments for why). process.env
 * is restored after every test so these mutations can't leak into other integration spec files
 * sharing this same --runInBand process.
 */
const MODULE_PATH = '../../scripts/lib/test-database-url';

type GuardModule = typeof import('../../scripts/lib/test-database-url');

function loadGuardModule(): GuardModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(MODULE_PATH);
}

describe('resolveTestDatabaseUrl (regression)', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('throws when DATABASE_URL_TEST resolves to the same database as DATABASE_URL', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/same host\/port\/database/);
  });

  it('treats different credentials on the same host/port/database as the same target', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://devuser:devpass@localhost:5432/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://otheruser:otherpass@localhost:5432/fulfillos';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/same host\/port\/database/);
  });

  it('treats an implicit default port and an explicit :5432 as the same target', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/same host\/port\/database/);
  });

  it('throws when DATABASE_URL_TEST is unset', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
    delete process.env.DATABASE_URL_TEST;

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/must be set/);
  });

  it('throws when NODE_ENV=production, regardless of otherwise-valid values', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos_test';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/production/);
  });

  it('throws when the test database name does not contain "test"', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos_staging';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(() => resolveTestDatabaseUrl()).toThrow(/must contain "test"/);
  });

  it.each(['fulfillos', 'postgres', 'template0', 'template1'])(
    'refuses to resolve a known non-test database name (%s) as the test database',
    (knownName) => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL =
        'postgresql://fulfillos:fulfillos@some-other-host:5432/fulfillos';
      process.env.DATABASE_URL_TEST = `postgresql://fulfillos:fulfillos@localhost:5432/${knownName}`;

      // None of these known names contain "test", so the same code path that protects
      // against a bare "point DATABASE_URL_TEST at a real database" mistake fires here too —
      // this test's job is to confirm resolution is refused either way, not which check wins.
      const { resolveTestDatabaseUrl } = loadGuardModule();
      expect(() => resolveTestDatabaseUrl()).toThrow();
    },
  );

  it('accepts a correctly configured, distinct test database URL', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
    process.env.DATABASE_URL_TEST =
      'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos_test';

    const { resolveTestDatabaseUrl } = loadGuardModule();
    expect(resolveTestDatabaseUrl()).toBe(process.env.DATABASE_URL_TEST);
  });
});

describe('assertConnectedToTestDatabase (regression, live connection)', () => {
  let pool: Pool;
  let testDatabaseUrl: string;

  beforeAll(() => {
    testDatabaseUrl = process.env.DATABASE_URL_TEST as string;
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('resolves when the live connection matches the expected test database', async () => {
    const { assertConnectedToTestDatabase } = loadGuardModule();
    await expect(
      assertConnectedToTestDatabase(pool, testDatabaseUrl),
    ).resolves.toBeUndefined();
  });

  it('throws when the live connection does not match the expected database name', async () => {
    const { assertConnectedToTestDatabase } = loadGuardModule();
    await expect(
      assertConnectedToTestDatabase(
        pool,
        'postgresql://fulfillos:fulfillos@localhost:5432/some_other_test_db',
      ),
    ).rejects.toThrow(/Refusing to proceed/);
  });
});
