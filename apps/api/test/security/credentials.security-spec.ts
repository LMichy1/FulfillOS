import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import { registerUser, loginUser } from './setup/auth-helpers';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';
import { users } from '../../src/database/schema';

function loginRaw(app: INestApplication, email: string, password: string) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
}

describe('credentials (security)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    app = await createSecurityTestApp();
    db = await getTestDb();
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

  it('registers successfully and never returns a password hash', async () => {
    const response = await registerUser(app, {
      email: 'alice@example.com',
      password: 'correct horse battery staple',
      displayName: 'Alice',
      organizationName: 'Alice Org',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(
      'correct horse battery staple',
    );
  });

  it('rejects a duplicate email registration with a conflict, not a 500 or a silent success', async () => {
    const input = {
      email: 'dupe@example.com',
      password: 'correct horse battery staple',
      displayName: 'First',
      organizationName: 'First Org',
    };
    await registerUser(app, input);

    const second = await registerUser(app, {
      ...input,
      displayName: 'Second',
      organizationName: 'Second Org',
    });

    expect(second.status).toBe(409);
  });

  it('stores a real Argon2id hash, not the plaintext password', async () => {
    await registerUser(app, {
      email: 'hash-check@example.com',
      password: 'correct horse battery staple',
      displayName: 'Hash Check',
      organizationName: 'Hash Check Org',
    });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'hash-check@example.com'));
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('correct horse battery staple');
  });

  it('logs in successfully with correct credentials and never leaks a password hash', async () => {
    await registerUser(app, {
      email: 'login-ok@example.com',
      password: 'correct horse battery staple',
      displayName: 'Login OK',
      organizationName: 'Login OK Org',
    });

    const session = await loginUser(
      app,
      'login-ok@example.com',
      'correct horse battery staple',
    );
    expect(session.csrfToken).toBeTruthy();
    expect(session.userId).toBeTruthy();

    const me = await session.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toMatch(/argon2/i);
  });

  it('rejects an invalid password with a generic message', async () => {
    await registerUser(app, {
      email: 'wrong-pw@example.com',
      password: 'correct horse battery staple',
      displayName: 'Wrong PW',
      organizationName: 'Wrong PW Org',
    });

    const failed = await loginRaw(
      app,
      'wrong-pw@example.com',
      'totally different password',
    );
    expect(failed.status).toBe(401);
    expect(failed.body.message).toBe('Invalid email or password.');
  });

  it('rejects an unknown account with the exact same generic message as a wrong password', async () => {
    const unknown = await loginRaw(
      app,
      'nobody-registered@example.com',
      'irrelevant password',
    );

    await registerUser(app, {
      email: 'known-account@example.com',
      password: 'correct horse battery staple',
      displayName: 'Known',
      organizationName: 'Known Org',
    });
    const wrongPassword = await loginRaw(
      app,
      'known-account@example.com',
      'wrong password here',
    );

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.message).toBe(wrongPassword.body.message);
  });
});
