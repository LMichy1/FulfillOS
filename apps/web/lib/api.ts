/**
 * Thin client for the real NestJS API — every auth/authorization decision is made server-side
 * by apps/api; nothing here duplicates that logic. Uses `credentials: 'include'` so the
 * HttpOnly session cookie is sent automatically, and reads the CSRF token from its own
 * (deliberately non-HttpOnly — see ADR-004) cookie to attach as a header on mutating
 * requests, rather than keeping it in any component state that could go stale.
 *
 * Every method that maps to a backend route guarded by the idempotency mechanism (see
 * docs/architecture/inventory.md#idempotency and docs/architecture/order-lifecycle.md) takes
 * an explicit `idempotencyKey` argument rather than generating one internally — the caller
 * (see lib/idempotency.ts) is what decides whether a retry reuses the same key or a new one,
 * and that decision belongs to the component driving the user's actual retry, not this client.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CSRF_COOKIE_NAME = 'fulfillos.csrf';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True for a 401 from the API — the caller should treat the session as gone (clear local auth
 * state, redirect to /login) rather than displaying this as a form-level error. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface ApiFetchOptions extends RequestInit {
  idempotencyKey?: string;
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { idempotencyKey, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      method,
      headers,
      credentials: 'include',
    });
  } catch (cause) {
    // A request aborted via AbortController (e.g. an organization switch cancelling a
    // stale in-flight request) rejects with a DOMException named "AbortError" — let that
    // propagate as-is so callers can distinguish "cancelled on purpose" from "network
    // failure" instead of both surfacing as the same generic ApiError.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      (body && typeof body.message === 'string' && body.message) ||
      (body && Array.isArray(body.message) && body.message.join(', ')) ||
      `Request failed (${response.status}).`;
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export type MembershipRole = 'owner' | 'staff';

export interface OrganizationSummary {
  id: string;
  name: string;
  role: MembershipRole;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export type ProductStatus = 'active' | 'archived';

export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  status: ProductStatus;
  createdAt: string;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  unitPriceCents: number;
  initialOnHand?: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface InventoryLine {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
}

export type OrderStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  currency: string;
  createdAt: string;
}

export interface OrderItemDetail {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDetail extends OrderSummary {
  updatedAt: string;
  cancelledAt: string | null;
  fulfilledAt: string | null;
  items: OrderItemDetail[];
}

export interface ReservationResult {
  orderId: string;
  status: OrderStatus;
  currency: string;
  items: Array<{ productId: string; quantity: number; unitPriceCents: number }>;
  createdAt: string;
}

export interface TransitionResult {
  orderId: string;
  status: OrderStatus;
  cancelledAt?: string | null;
  fulfilledAt?: string | null;
}

export interface DashboardSummary {
  totalProducts: number;
  pendingOrders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  lowStockProducts: number;
}

export interface PageQuery {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
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

  me: (signal?: AbortSignal) => apiFetch<{ user: AuthUser }>('/auth/me', { signal }),

  listOrganizations: (signal?: AbortSignal) =>
    apiFetch<{ organizations: OrganizationSummary[] }>('/organizations', { signal }),

  getOrganization: (organizationId: string, signal?: AbortSignal) =>
    apiFetch<{ organization: { id: string; name: string }; role: MembershipRole }>(
      `/organizations/${organizationId}`,
      { signal },
    ),

  renameOrganization: (organizationId: string, name: string) =>
    apiFetch<{ organization: { id: string; name: string } }>(`/organizations/${organizationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  getDashboardSummary: (organizationId: string, signal?: AbortSignal) =>
    apiFetch<{ summary: DashboardSummary }>(`/organizations/${organizationId}/dashboard/summary`, {
      signal,
    }),

  listProducts: (organizationId: string, query: PageQuery = {}) =>
    apiFetch<CursorPage<ProductSummary>>(
      `/organizations/${organizationId}/products${toQueryString(query)}`,
      { signal: query.signal },
    ),

  getProduct: (organizationId: string, productId: string, signal?: AbortSignal) =>
    apiFetch<{ product: ProductDetail }>(`/organizations/${organizationId}/products/${productId}`, {
      signal,
    }),

  createProduct: (organizationId: string, input: CreateProductInput) =>
    apiFetch<{ product: ProductDetail }>(`/organizations/${organizationId}/products`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listInventory: (organizationId: string, signal?: AbortSignal) =>
    apiFetch<{ inventory: InventoryLine[] }>(`/organizations/${organizationId}/inventory`, {
      signal,
    }),

  adjustInventory: (
    organizationId: string,
    input: { productId: string; delta: number; reason: string },
    idempotencyKey: string,
  ) =>
    apiFetch<{ inventory: InventoryLine }>(
      `/organizations/${organizationId}/inventory/adjustments`,
      { method: 'POST', body: JSON.stringify(input), idempotencyKey },
    ),

  listOrders: (organizationId: string, query: PageQuery = {}) =>
    apiFetch<CursorPage<OrderSummary>>(
      `/organizations/${organizationId}/orders${toQueryString(query)}`,
      { signal: query.signal },
    ),

  getOrder: (organizationId: string, orderId: string, signal?: AbortSignal) =>
    apiFetch<{ order: OrderDetail }>(`/organizations/${organizationId}/orders/${orderId}`, {
      signal,
    }),

  createReservation: (
    organizationId: string,
    input: { items: Array<{ productId: string; quantity: number }>; currency?: string },
    idempotencyKey: string,
  ) =>
    apiFetch<{ reservation: ReservationResult }>(`/organizations/${organizationId}/reservations`, {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    }),

  fulfillOrder: (organizationId: string, orderId: string, idempotencyKey: string) =>
    apiFetch<{ order: TransitionResult }>(
      `/organizations/${organizationId}/orders/${orderId}/fulfill`,
      { method: 'POST', idempotencyKey },
    ),

  cancelOrder: (organizationId: string, orderId: string, idempotencyKey: string) =>
    apiFetch<{ order: TransitionResult }>(
      `/organizations/${organizationId}/orders/${orderId}/cancel`,
      { method: 'POST', idempotencyKey },
    ),
};

function toQueryString(query: { limit?: number; cursor?: string }): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.cursor) {
    params.set('cursor', query.cursor);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
