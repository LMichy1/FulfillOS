import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';

export const productStatusEnum = pgEnum('product_status', [
  'active',
  'archived',
]);

/**
 * SKU normalization policy: `skuNormalized` (database-generated, stored: `lower(btrim(sku))`)
 * is what uniqueness is enforced against, scoped per organization. Two products in the same
 * organization cannot share a SKU regardless of case or surrounding whitespace; the same SKU
 * text is allowed across different organizations. `sku` retains the value as entered.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    skuNormalized: text('sku_normalized')
      .notNull()
      .generatedAlwaysAs(sql`lower(btrim(sku))`),
    name: text('name').notNull(),
    description: text('description'),
    unitPriceCents: integer('unit_price_cents').notNull(),
    status: productStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('products_org_sku_normalized_key').on(
      table.organizationId,
      table.skuNormalized,
    ),
    // Composite-FK target: lets inventory/order_items prove a product row's organization_id
    // matches the organization the referencing row claims, not just that *some* product
    // with this id exists.
    unique('products_id_org_key').on(table.id, table.organizationId),
    check(
      'products_unit_price_cents_non_negative',
      sql`${table.unitPriceCents} >= 0`,
    ),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
