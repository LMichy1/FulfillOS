import {
  pgTable,
  pgEnum,
  integer,
  text,
  timestamp,
  uuid,
  jsonb,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { products } from './products.schema';

/**
 * Append-only ledger of inventory changes, for traceability. Schema only in Milestone 1 —
 * no application code writes to this table yet. Milestone 3's reservation/release logic is
 * expected to insert one row per stock change inside the same transaction that updates
 * `inventory.on_hand`/`inventory.reserved`, so every quantity change is explainable after
 * the fact.
 */
export const inventoryMovementTypeEnum = pgEnum('inventory_movement_type', [
  'on_hand_adjustment',
  'reservation',
  'release',
  // Milestone 4: consumes a reservation permanently — decreases both on_hand and reserved
  // (unlike 'release', which only decreases reserved). See docs/architecture/order-lifecycle.md.
  'fulfillment',
]);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    movementType: inventoryMovementTypeEnum('movement_type').notNull(),
    onHandDelta: integer('on_hand_delta').notNull().default(0),
    reservedDelta: integer('reserved_delta').notNull().default(0),
    reason: text('reason').notNull(),
    // Free-form pointer to the causing record (e.g. an order id), intentionally not a
    // foreign key: the referenced entity type varies by movement_type.
    reference: jsonb('reference').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.productId, table.organizationId],
      foreignColumns: [products.id, products.organizationId],
      name: 'inventory_movements_product_org_fk',
    }).onDelete('cascade'),
    // "Movement history for product X" is the expected primary access pattern.
    index('inventory_movements_product_id_created_at_idx').on(
      table.productId,
      table.createdAt,
    ),
  ],
);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
