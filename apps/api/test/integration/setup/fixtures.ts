import { organizations, users } from '../../../src/database/schema';
import type { TestDatabase } from './test-db';

/**
 * Deliberately minimal, deterministic fixture helpers — every value that must be unique
 * within a test (email, sku, ...) is a required argument, never randomly generated, so test
 * failures are reproducible.
 */

export async function insertOrganization(db: TestDatabase, name: string) {
  const [organization] = await db
    .insert(organizations)
    .values({ name })
    .returning();
  return organization;
}

export async function insertUser(
  db: TestDatabase,
  params: { email: string; displayName: string },
) {
  const [user] = await db
    .insert(users)
    .values({
      email: params.email,
      displayName: params.displayName,
      // Not a real hash — no authentication code exists yet to verify it against.
      passwordHash: 'unused-in-milestone-1',
    })
    .returning();
  return user;
}
