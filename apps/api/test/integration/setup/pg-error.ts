/**
 * drizzle-orm wraps the underlying pg driver error in a DrizzleQueryError, with the original
 * error (which carries the Postgres SQLSTATE `.code`) attached as `.cause`. This unwraps
 * either shape so tests can assert on the specific constraint violation rather than "any
 * error was thrown".
 */
export function pgErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code ?? (error as { code?: string } | undefined)?.code;
}

/** Asserts a promise rejects with the given Postgres SQLSTATE code (not just any error). */
export async function expectPgErrorCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actualCode = pgErrorCode(error);
    if (actualCode !== expectedCode) {
      throw new Error(
        `Expected Postgres error code ${expectedCode}, got ${actualCode ?? '(none)'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return;
  }
  throw new Error(
    `Expected the operation to reject with Postgres error code ${expectedCode}, but it succeeded.`,
  );
}
