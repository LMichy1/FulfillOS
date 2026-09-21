import {
  pgTable,
  pgEnum,
  timestamp,
  uuid,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { users } from './users.schema';

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'staff']);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A user cannot have two memberships in the same organization. This also serves as the
    // index for "list members of organization X" (organization_id is the leftmost column).
    unique('memberships_org_user_key').on(table.organizationId, table.userId),
    // "List organizations user X belongs to" needs its own index (user_id is not the
    // leftmost column of the constraint above).
    index('memberships_user_id_idx').on(table.userId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
