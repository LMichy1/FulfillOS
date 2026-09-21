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
import { sessions } from '../../src/database/schema';

const CREDENTIALS = {
  email: 'session-user@example.com',
  password: 'correct horse battery staple',
  displayName: 'Session User',
  organizationName: 'Session Org',
};

async function registerFixtureUser(app: INestApplication) {
  await registerUser(app, CREDENTIALS);
}

describe('sessions (security)', () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    app = await createSecurityTestApp();
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    await flushTestRedis();
    await registerFixtureUser(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
    await closeTestRedis();
  });

  it('creates a database-backed session on login and lets /auth/me retrieve the identity', async () => {
    const session = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, session.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();

    const me = await session.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(CREDENTIALS.email);
  });

  it('issues a distinct fresh session token on every login', async () => {
    const first = await loginUser(app, CREDENTIALS.email, CREDENTIALS.password);
    const second = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, first.userId));
    expect(rows).toHaveLength(2);
    expect(rows[0].tokenHash).not.toBe(rows[1].tokenHash);

    // Both sessions are independently valid until one is revoked.
    expect((await first.agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await second.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('never issues a pre-authentication cookie value as the authenticated session (fixation)', async () => {
    // A client-supplied cookie sent BEFORE authenticating — as an attacker attempting session
    // fixation would try to plant. It doesn't correspond to any real session.
    const plantedToken =
      'attacker-planted-token-value-0000000000000000000000000';

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', [`fulfillos.sid=${plantedToken}`])
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });

    expect(loginResponse.status).toBe(200);
    const setCookieHeader = loginResponse.headers[
      'set-cookie'
    ] as unknown as string[];
    const sessionCookie = setCookieHeader.find((c) =>
      c.startsWith('fulfillos.sid='),
    );
    expect(sessionCookie).toBeDefined();
    // The server-issued cookie is not the value the client tried to plant.
    expect(sessionCookie).not.toContain(plantedToken);

    // The planted value was never valid to begin with.
    const withPlantedToken = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`fulfillos.sid=${plantedToken}`]);
    expect(withPlantedToken.status).toBe(401);
  });

  it('revokes the session on logout and rejects the old cookie afterward', async () => {
    const session = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );

    const logoutResponse = await session.agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', session.csrfToken);
    expect(logoutResponse.status).toBe(204);

    const afterLogout = await session.agent.get('/api/v1/auth/me');
    expect(afterLogout.status).toBe(401);

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, session.userId));
    expect(rows[0].revokedAt).not.toBeNull();
  });

  it('rejects a session past its idle expiration', async () => {
    const session = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );
    await db
      .update(sessions)
      .set({ idleExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.userId, session.userId));

    const response = await session.agent.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects a session past its absolute expiration even if recently active', async () => {
    const session = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );
    await db
      .update(sessions)
      .set({
        absoluteExpiresAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
        idleExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(sessions.userId, session.userId));

    const response = await session.agent.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects a tampered session cookie', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: CREDENTIALS.email, password: CREDENTIALS.password });
    const setCookieHeader = loginResponse.headers[
      'set-cookie'
    ] as unknown as string[];
    const sessionCookie = setCookieHeader.find((c) =>
      c.startsWith('fulfillos.sid='),
    );
    expect(sessionCookie).toBeDefined();
    const realToken = sessionCookie!.split(';')[0].split('=')[1];

    // Flip the last character of a genuinely-issued token — same length/shape as a real
    // token, but hashes to something with no matching session row.
    const tampered =
      realToken.slice(0, -1) + (realToken.endsWith('A') ? 'B' : 'A');

    const tamperedResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`fulfillos.sid=${tampered}`]);

    expect(tamperedResponse.status).toBe(401);

    // Sanity check: the real, untampered token still works.
    const realResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`fulfillos.sid=${realToken}`]);
    expect(realResponse.status).toBe(200);
  });

  it('rejects a malformed/invalid cookie value outright', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', ['fulfillos.sid=not-even-base64url!!!']);
    expect(response.status).toBe(401);
  });

  it('rejects requests with no session cookie at all', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Authentication required.');
  });
});
