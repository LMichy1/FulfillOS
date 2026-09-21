import {
  pgTable,
  pgEnum,
  char,
  timestamp,
  uuid,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';

/**
 * Order lifecycle (creation, fulfillment, and cancellation — no shipping workflow beyond
 * fulfillment exists). This enum only constrains status to a known value; it does NOT enforce
 * which transitions are legal (e.g. it will not stop an update from moving a `cancelled` order
 * back to `pending` at the database level). Permitted transitions:
 *
 *   pending -> fulfilled   (terminal; inventory reservation is consumed, not released)
 *   pending -> cancelled   (terminal; inventory reservation is released)
 *
 * `fulfilled` and `cancelled` are both terminal — no further transitions are permitted from
 * either. Enforced by the application layer (Milestone 4, `ReservationsService`) via a single
 * conditional `UPDATE ... WHERE status = 'pending'`, not a stateless CHECK constraint — see
 * docs/architecture/order-lifecycle.md.
 */
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'fulfilled',
  'cancelled',
]);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Unlike most tenant-owned tables here, orders use ON DELETE RESTRICT rather than
    // CASCADE: an order is a financial/business record, not disposable configuration, so an
    // organization delete (not currently an implemented feature) must not silently destroy
    // order history.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('pending'),
    // ISO 4217 currency code. Stored per order (not assumed globally) so a future
    // multi-currency organization doesn't require a schema change.
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  },
  (table) => [
    // Composite-FK target: lets order_items prove it references a product AND an order
    // that both belong to the organization order_items itself claims to belong to.
    unique('orders_id_org_key').on(table.id, table.organizationId),
    // "List orders for organization X" (the primary order-listing query) needs its own
    // index; created_at is included since listing is expected to sort newest-first.
    index('orders_organization_id_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
