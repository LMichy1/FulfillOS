import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Email normalization policy: `emailNormalized` is a database-generated, stored column
 * (`lower(btrim(email))`). Uniqueness is enforced on the normalized value, not on `email`
 * itself, so "User@Example.com" and " user@example.com " collide with "user@example.com"
 * regardless of what the application layer does. `email` keeps the value as the user typed
 * it, for display purposes only — never rely on it for lookups or uniqueness checks.
 *
 * `passwordHash` is intended to hold an argon2id hash (Milestone 2 implements the actual
 * hashing/verification). This schema does not insert or assume any password value; no demo
 * credentials exist anywhere in this codebase.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized')
      .notNull()
      .generatedAlwaysAs(sql`lower(btrim(email))`),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_normalized_key').on(table.emailNormalized),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
