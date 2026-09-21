import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys are sorted recursively so two payloads that
 * are semantically identical but were constructed (or JSON.stringify'd) with keys in a
 * different order still produce the same string. Array order is preserved — it's
 * semantically meaningful for e.g. a reservation's line items.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A stable fingerprint of a request payload, used to detect whether a reused idempotency key
 * is a genuine retry (same fingerprint) or the key being reused for a different request (a
 * conflict to reject) — see docs/architecture/inventory.md#idempotency.
 */
export function canonicalFingerprint(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
