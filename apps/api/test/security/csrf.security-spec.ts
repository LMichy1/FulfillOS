import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createSecurityTestApp } from './setup/app';
import { flushTestRedis, closeTestRedis } from './setup/redis';
import {
  registerAndLogin,
  registerUser,
  loginUser,
} from './setup/auth-helpers';
import {
  closeTestDb,
  getTestDb,
  truncateAll,
  type TestDatabase,
} from '../integration/setup/test-db';

const CREDENTIALS = {
  email: 'csrf-user@example.com',
  password: 'correct horse battery staple',
  displayName: 'CSRF User',
  organizationName: 'CSRF Org',
};

describe('CSRF (security)', () => {
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

  it('accepts a mutating request with a valid, session-bound CSRF token', async () => {
    const { agent, csrfToken, organizationId } = await registerAndLogin(
      app,
      CREDENTIALS,
    );

    const response = await agent
      .patch(`/api/v1/organizations/${organizationId}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed via valid CSRF' });

    expect(response.status).toBe(200);
    expect(response.body.organization.name).toBe('Renamed via valid CSRF');
  });

  it('rejects a mutating request with no CSRF token at all', async () => {
    const { agent, organizationId } = await registerAndLogin(app, CREDENTIALS);

    const response = await agent
      .patch(`/api/v1/organizations/${organizationId}`)
      .send({ name: 'Should not apply' });

    expect(response.status).toBe(403);
  });

  it('rejects a mutating request with an incorrect CSRF token', async () => {
    const { agent, organizationId } = await registerAndLogin(app, CREDENTIALS);

    const response = await agent
      .patch(`/api/v1/organizations/${organizationId}`)
      .set('X-CSRF-Token', 'completely-made-up-token-value')
      .send({ name: 'Should not apply' });

    expect(response.status).toBe(403);
  });

  it('rejects a forged request that carries the session cookie but not its CSRF token', async () => {
    // Models the scenario CSRF protection exists for: a request arrives with the victim's
    // session cookie attached (as a browser would do automatically for a same-site request)
    // but without the CSRF token, which an attacker's page has no way to read (it's never in
    // a cookie the attacker's origin can access via document.cookie cross-site, nor in the
    // JSON body of any response their origin's fetch could read without CORS permission).
    const { agent, organizationId } = await registerAndLogin(app, CREDENTIALS);

    const forged = await agent
      .patch(`/api/v1/organizations/${organizationId}`)
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'Forged rename' });

    expect(forged.status).toBe(403);
  });

  it('does not reflect an untrusted origin in CORS headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Origin', 'https://evil.example.com');

    // A real browser refuses to let cross-origin JS read the response unless
    // Access-Control-Allow-Origin matches the request's Origin; it must not be reflected
    // back for an untrusted origin, and must never be a wildcard on a credentialed route.
    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://evil.example.com',
    );
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('invalidates the old CSRF token once its session is replaced by a new login', async () => {
    await registerUser(app, CREDENTIALS);

    const firstSession = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );
    await firstSession.agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', firstSession.csrfToken);

    const secondSession = await loginUser(
      app,
      CREDENTIALS.email,
      CREDENTIALS.password,
    );

    // The new session's own agent (its own cookie) but the OLD session's CSRF token.
    const orgsResponse = await secondSession.agent.get('/api/v1/organizations');
    const organizationId = orgsResponse.body.organizations[0].id;

    const response = await secondSession.agent
      .patch(`/api/v1/organizations/${organizationId}`)
      .set('X-CSRF-Token', firstSession.csrfToken)
      .send({ name: 'Should not apply either' });

    expect(response.status).toBe(403);
  });
});
