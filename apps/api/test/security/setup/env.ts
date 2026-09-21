import 'dotenv/config';
import { resolveTestDatabaseUrl } from '../../../scripts/lib/test-database-url';

/**
 * Registered as jest-security.json's `setupFiles`, so this runs — and DATABASE_URL/REDIS_URL
 * are already overridden — BEFORE the test file's own `import { AppModule } from '...'`
 * executes. This matters: `AppModule`'s `@Module({imports: [ConfigModule.forRoot({validate})]})`
 * decorator evaluates (and validates process.env) at class-definition time, i.e. the moment
 * app.module.ts is imported — not later, when `Test.createTestingModule(...).compile()` runs.
 * Overriding these env vars from inside a function called after that import (as an earlier,
 * buggy version of this harness did) has no effect: ConfigService ends up serving whatever
 * process.env held at import time, permanently, for the rest of the process — which, without
 * this file, silently pointed the whole test suite at the real development database instead
 * of the test one.
 */
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.REDIS_URL =
  process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/1';
