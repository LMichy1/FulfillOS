import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
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
