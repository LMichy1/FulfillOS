/**
 * Thin client for the real NestJS API — every auth/authorization decision is made server-side
 * by apps/api; nothing here duplicates that logic. Uses `credentials: 'include'` so the
 * HttpOnly session cookie is sent automatically, and reads the CSRF token from its own
 * (deliberately non-HttpOnly — see ADR-004) cookie to attach as a header on mutating
 * requests, rather than keeping it in any component state that could go stale.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CSRF_COOKIE_NAME = 'fulfillos.csrf';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      (body && typeof body.message === 'string' && body.message) ||
      (body && Array.isArray(body.message) && body.message.join(', ')) ||
      `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }

  return body as T;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  role: 'owner' | 'staff';
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export const api = {
  register: (input: RegisterInput) =>
    apiFetch<{ user: AuthUser; organizationId: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    apiFetch<{ user: AuthUser; csrfToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ user: AuthUser }>('/auth/me'),

  listOrganizations: () => apiFetch<{ organizations: OrganizationSummary[] }>('/organizations'),

  getOrganization: (organizationId: string) =>
    apiFetch<{ organization: { id: string; name: string }; role: 'owner' | 'staff' }>(
      `/organizations/${organizationId}`,
    ),

  renameOrganization: (organizationId: string, name: string) =>
    apiFetch<{ organization: { id: string; name: string } }>(`/organizations/${organizationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
};
