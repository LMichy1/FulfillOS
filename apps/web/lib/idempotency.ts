'use client';

import { useCallback, useState } from 'react';

function generateKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID. This is a client-generated
  // retry-correlation token the backend uses to detect a duplicate submission — not a secret
  // and not security-sensitive, so a non-cryptographic fallback is fine.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A stable idempotency key for one logical submission attempt (order creation, order
 * fulfillment/cancellation, inventory adjustment — see
 * docs/architecture/order-lifecycle.md#idempotency). The key is generated once, on mount, and
 * stays the same across re-renders and across retries of that same attempt — including a retry
 * after a network failure or an ambiguous timeout, which is exactly when reusing the key
 * matters: it lets the backend recognize "this is the same request again" rather than
 * double-applying a mutation.
 *
 * Call `renew()` only when the user is starting a genuinely new logical attempt (e.g. after a
 * successful submission, before allowing another one from the same mounted form) — never
 * automatically on every retry.
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(generateKey);
  const renew = useCallback(() => setKey(generateKey()), []);
  return { key, renew };
}
