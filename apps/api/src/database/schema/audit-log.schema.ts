import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { users } from './users.schema';

/**
 * Minimal, append-only audit trail. `resourceId` is intentionally untyped text rather than a
 * foreign key: audit records reference many different resource types (products, orders,
 * memberships, ...) and a generic audit log cannot practically hold one FK per possible
 * resource table. This means referential integrity for `resourceId` is NOT enforced by the
 * database — a resource can be deleted after being referenced by an audit row (the audit
 * row is expected to outlive the resource; that is the point of an audit trail).
 *
 * `actorUserId` is nullable and ON DELETE SET NULL: an audit record must survive the actor
 * user account being deleted later.
 *
 * Known limitations (see docs/architecture/database.md): this table has no database-level
 * protection against UPDATE/DELETE by the application's own database role in this milestone
 * — "append-only" is an application-level convention here, not yet a database-enforced
 * guarantee. Never store passwords, session secrets, access tokens, or full request bodies
 * in `metadata`.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "Show recent audit events for organization X" is the expected primary access pattern.
    index('audit_log_organization_id_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
