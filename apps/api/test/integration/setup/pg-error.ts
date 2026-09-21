import { pgErrorCode } from '../../../src/common/pg-error.util';

export { pgErrorCode };

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
