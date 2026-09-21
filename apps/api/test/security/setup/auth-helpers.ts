import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export function registerUser(app: INestApplication, input: RegisterInput) {
  return request(app.getHttpServer()).post('/api/v1/auth/register').send(input);
}

export interface LoggedInSession {
  /** A supertest agent that persists the Set-Cookie headers (session + CSRF) across
   * requests, exactly like a real browser tab would. */
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  userId: string;
}

export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<LoggedInSession> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (response.status !== 200) {
    throw new Error(
      `Test helper loginUser failed: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return {
    agent,
    csrfToken: response.body.csrfToken,
    userId: response.body.user.id,
  };
}

/** Registers a fresh user + organization and immediately logs them in — the common setup
 * step most security tests need. */
export async function registerAndLogin(
  app: INestApplication,
  input: RegisterInput,
): Promise<LoggedInSession & { organizationId: string }> {
  const registerResponse = await registerUser(app, input);
  if (registerResponse.status !== 201) {
    throw new Error(
      `Test helper registerAndLogin failed to register: ${registerResponse.status} ${JSON.stringify(registerResponse.body)}`,
    );
  }
  const session = await loginUser(app, input.email, input.password);
  return { ...session, organizationId: registerResponse.body.organizationId };
}
