import {
  pgTable,
  integer,
  timestamp,
  uuid,
  foreignKey,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { orders } from './orders.schema';
import { products } from './products.schema';

/**
 * `organizationId` is denormalized from the parent order (rather than looked up through
 * `orderId`) specifically so it can participate in composite foreign keys against both
 * `orders.(id, organization_id)` and `products.(id, organization_id)`. This is what makes
 * "an order item can only reference a product from its own order's organization"
 * database-enforced rather than merely application-enforced.
 *
 * `unitPriceCents` is a snapshot of the product's price at order time, not a live read of
 * `products.unit_price_cents` — historical orders must not change value if a product's price
 * changes later.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.orderId, table.organizationId],
      foreignColumns: [orders.id, orders.organizationId],
      name: 'order_items_order_org_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.productId, table.organizationId],
      foreignColumns: [products.id, products.organizationId],
      name: 'order_items_product_org_fk',
    }).onDelete('restrict'),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'order_items_unit_price_cents_non_negative',
      sql`${table.unitPriceCents} >= 0`,
    ),
    // "List items for order X" — not automatically indexed by the composite FK above.
    index('order_items_order_id_idx').on(table.orderId),
  ],
);

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
