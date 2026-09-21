import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

/** Redis-backed fixed-window rate limit for a single route (see guards/rate-limit.guard.ts).
 * Keyed by client IP + route, not by any per-instance in-memory state, so the limit is
 * consistent across multiple API instances sharing the same Redis. */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
