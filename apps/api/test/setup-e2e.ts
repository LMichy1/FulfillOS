// Ensures the e2e suite can boot AppModule (which validates required env vars via
// ConfigModule) even when no .env file is present. This suite only smoke-tests that the
// app wires up and routes respond — it does not assert database reachability. Real
// PostgreSQL-backed behavior is covered by the separate integration test suite in
// test/integration/, which requires DATABASE_URL_TEST to point at a real, disposable
// database.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://fulfillos:fulfillos@localhost:5432/fulfillos';
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
