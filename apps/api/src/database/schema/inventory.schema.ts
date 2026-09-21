import {
  pgTable,
  integer,
  timestamp,
  uuid,
  unique,
  check,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { products } from './products.schema';

/**
 * One inventory row per product (MVP scope — see ADR-002; a multi-warehouse model is not
 * implemented and is not assumed here). PostgreSQL is the sole source of truth for
 * on_hand/reserved; nothing else (e.g. Redis) may hold a writable copy of these quantities.
 *
 * `available` is a derived quantity (`on_hand - reserved`), not a stored column, so it can
 * never drift out of sync with the two authoritative counters.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('inventory_product_id_key').on(table.productId),
    // "List inventory for organization X" (e.g. a dashboard overview) needs its own index.
    index('inventory_organization_id_idx').on(table.organizationId),
    // Ties (product_id, organization_id) to products.(id, organization_id): an inventory
    // row can only ever reference a product that belongs to the same organization.
    foreignKey({
      columns: [table.productId, table.organizationId],
      foreignColumns: [products.id, products.organizationId],
      name: 'inventory_product_org_fk',
    }).onDelete('cascade'),
    check('inventory_on_hand_non_negative', sql`${table.onHand} >= 0`),
    check('inventory_reserved_non_negative', sql`${table.reserved} >= 0`),
    check(
      'inventory_reserved_not_exceeding_on_hand',
      sql`${table.reserved} <= ${table.onHand}`,
    ),
  ],
);

export type Inventory = typeof inventory.$inferSelect;
export type NewInventory = typeof inventory.$inferInsert;
