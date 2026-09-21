import {
  pgTable,
  pgEnum,
  text,
  integer,
  jsonb,
  timestamp,
  uuid,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';

/**
 * Database-backed idempotency mechanism (see ADR-002). This schema intentionally does not
 * implement any request-handling logic — that is Milestone 3's job — but it is designed so
 * that logic can be correct:
 *
 * - The UNIQUE constraint on (organization_id, operation, idempotency_key) is what makes a
 *   "check then insert" race impossible: a second concurrent request with the same key can
 *   only succeed at inserting if the first request hasn't already claimed the row, and the
 *   database — not application code — is the arbiter.
 * - `requestFingerprint` (a hash of the canonicalized request payload) lets the application
 *   layer distinguish a genuine retry (same key, same fingerprint -> replay the stored
 *   response) from a key reused with a different payload (same key, different fingerprint
 *   -> reject with a conflict), without re-deciding business logic.
 * - `state` lets the application layer tell the difference between "still processing"
 *   (a concurrent request should wait or receive 409, not proceed as if this were new),
 *   "completed" (replay `responseStatus`/`responseBody`), and "failed" (the original attempt
 *   did not complete; whether a retry is safe is an application-layer decision, not encoded
 *   here).
 * - Rows are expected to be inserted in the SAME transaction as the operation they guard,
 *   with the unique constraint doing the work of rejecting a concurrent duplicate — not a
 *   separate "does a row exist?" check followed by a separate insert.
 * - `expiresAt` documents an intended cleanup policy; no expiry/cleanup job exists yet in
 *   this milestone.
 */
export const idempotencyStateEnum = pgEnum('idempotency_state', [
  'in_progress',
  'completed',
  'failed',
]);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    state: idempotencyStateEnum('state').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '24 hours')`),
  },
  (table) => [
    unique('idempotency_keys_org_operation_key_key').on(
      table.organizationId,
      table.operation,
      table.idempotencyKey,
    ),
    check(
      'idempotency_keys_completed_has_response',
      sql`${table.state} <> 'completed' OR ${table.responseStatus} IS NOT NULL`,
    ),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
