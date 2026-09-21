import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';

/**
 * Database-backed, opaque server-side sessions (ADR-003). The raw session token is never
 * stored — only `tokenHash` (a SHA-256 hex digest of it), so a database read (backup leak,
 * SQL injection, etc.) cannot be turned directly into a usable session cookie. The same
 * applies to `csrfSecretHash` (ADR-004): the raw CSRF secret handed to the client is never
 * persisted, only its hash.
 *
 * Two independent expiration mechanisms are stored explicitly rather than derived purely in
 * application code:
 * - `idleExpiresAt` is recomputed on every "touch" (activity update) as
 *   `lastActivityAt + idle timeout`; a session left idle past this point is invalid even
 *   though its absolute lifetime hasn't elapsed.
 * - `absoluteExpiresAt` is fixed at session creation and never extended; a session is invalid
 *   past this point no matter how recently it was used.
 *
 * Both timeouts are application policy (see docs/architecture/authentication.md for the
 * current values), not a universal security standard — they're configurable, not hardcoded
 * security requirements.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfSecretHash: text('csrf_secret_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', {
      withTimezone: true,
    }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Primary lookup path: validating an incoming cookie means hashing its value and looking
    // up this column — unique (two sessions can never hash to the same token; a collision
    // here would mean one session's token authenticates as another) and indexed (every
    // authenticated request depends on this).
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    // Supports "list/revoke all sessions for this user" (e.g. a future "log out everywhere").
    index('sessions_user_id_idx').on(table.userId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
