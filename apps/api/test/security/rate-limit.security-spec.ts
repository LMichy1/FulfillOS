import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import {
  closeTestDb,
  getTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';

describe('rate limiting (security)', () => {
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

  it('rejects login attempts once the configured limit is exceeded, from the same client', async () => {
    // AuthController's @RateLimit for /auth/login is { limit: 10, windowSeconds: 900 }.
    const attempts = await Promise.all(
      Array.from({ length: 11 }, () =>
        request(app.getHttpServer()).post('/api/v1/auth/login').send({
          email: 'rate-limit-probe@example.com',
          password: 'irrelevant',
        }),
      ),
    );

    const statuses = attempts.map((response) => response.status);
    const tooManyRequests = statuses.filter((status) => status === 429);
    // At least one of the 11 concurrent attempts must be throttled; exactly how many succeed
    // vs. are throttled can vary slightly under concurrency, but the limit must bind.
    expect(tooManyRequests.length).toBeGreaterThan(0);
  });

  it('applies the limit per-route: exhausting /auth/login does not affect /auth/register', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer()).post('/api/v1/auth/login').send({
          email: 'rate-limit-probe-2@example.com',
          password: 'irrelevant',
        }),
      ),
    );

    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'not-rate-limited@example.com',
        password: 'correct horse battery staple',
        displayName: 'Not Rate Limited',
        organizationName: 'Not Rate Limited Org',
      });

    expect(registerResponse.status).toBe(201);
  });
});
