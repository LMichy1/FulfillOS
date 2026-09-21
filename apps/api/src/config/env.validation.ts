import { z } from 'zod';

/**
 * Milestone 0 originally reserved a SESSION_SECRET here for signing session cookies. It's
 * intentionally absent now: sessions are opaque, high-entropy random tokens verified against
 * the database (see docs/architecture/authentication.md), not signed/HMACed tokens, so there
 * is nothing for a server-side signing secret to do. Re-add one only if the session design
 * changes to need it.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().min(1).default('fulfillos.sid'),
  CSRF_COOKIE_NAME: z.string().min(1).default('fulfillos.csrf'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Passed to ConfigModule.forRoot({ validate }). Throws on startup (not on first request) if
 * required environment variables are missing or malformed, and never logs secret values —
 * only field names appear in the thrown error.
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const fieldNames = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(
      `Invalid environment configuration for: ${fieldNames.join(', ')}`,
    );
  }
  return result.data;
}
