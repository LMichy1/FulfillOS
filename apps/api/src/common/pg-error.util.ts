/**
 * drizzle-orm wraps the underlying pg driver error in a DrizzleQueryError, with the original
 * error (which carries the Postgres SQLSTATE `.code`) attached as `.cause`. This unwraps
 * either shape so callers can branch on the specific constraint violation rather than
 * catching "any error".
 */
export function pgErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code ?? (error as { code?: string } | undefined)?.code;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_NOT_NULL_VIOLATION = '23502';
