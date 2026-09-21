import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/configure-app';

/**
 * Boots the real AppModule through the same configureApp() wiring main.ts uses — real
 * Postgres, real Redis, real cookies, real guards. No mocking of session persistence, cookie
 * behavior, or authorization decisions in these security tests.
 *
 * DATABASE_URL/REDIS_URL are pointed at the test database and a dedicated Redis DB index by
 * test/security/setup/env.ts, registered as this suite's Jest `setupFiles` — that must run
 * (and it does, before this module or AppModule is ever imported) rather than being done here,
 * because AppModule's ConfigModule.forRoot({validate}) validates process.env at AppModule's
 * own import time, not when this function later calls .compile(). See env.ts for the full
 * explanation.
 */
export async function createSecurityTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
