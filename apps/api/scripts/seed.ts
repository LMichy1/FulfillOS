import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { organizations, products, inventory } from '../src/database/schema';

/**
 * Idempotent development seed: creates one fictional organization and a small product
 * catalog with inventory. Safe to run repeatedly — every row uses a fixed, deterministic id
 * (not a randomly generated one) specifically so a second run can recognize "this row
 * already exists" and skip it (ON CONFLICT DO NOTHING) rather than duplicate it or reset
 * whatever on_hand/reserved values a developer has since changed while testing.
 *
 * Deliberately out of scope: no users or memberships are seeded here. Authentication isn't
 * implemented yet (Milestone 2), and inserting a "demo user" would mean putting *some* value
 * in the required password_hash column — this script avoids that gray area entirely rather
 * than ship something that looks like a usable demo credential.
 *
 * All names below are fictional placeholders, unrelated to any real organization.
 */

const SEED_ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';

const SEED_PRODUCTS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    sku: 'TRAIL-BACKPACK-40L',
    name: 'Trail Backpack 40L',
    description: 'A 40-liter weatherproof backpack for multi-day hikes.',
    unitPriceCents: 8_999,
    onHand: 25,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    sku: 'INSULATED-BOTTLE-1L',
    name: 'Insulated Water Bottle 1L',
    description:
      'Vacuum-insulated stainless steel bottle, keeps drinks cold for 24 hours.',
    unitPriceCents: 2_499,
    onHand: 60,
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    sku: 'CAMP-STOVE-MINI',
    name: 'Camp Stove Mini',
    description: 'Compact folding camp stove for backpacking.',
    unitPriceCents: 4_299,
    onHand: 15,
  },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run the development seed with NODE_ENV=production.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set to run the seed script.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  await db
    .insert(organizations)
    .values({ id: SEED_ORGANIZATION_ID, name: 'Acme Trail Supply Co.' })
    .onConflictDoNothing({ target: organizations.id });

  for (const product of SEED_PRODUCTS) {
    await db
      .insert(products)
      .values({
        id: product.id,
        organizationId: SEED_ORGANIZATION_ID,
        sku: product.sku,
        name: product.name,
        description: product.description,
        unitPriceCents: product.unitPriceCents,
      })
      .onConflictDoNothing({ target: products.id });

    await db
      .insert(inventory)
      .values({
        organizationId: SEED_ORGANIZATION_ID,
        productId: product.id,
        onHand: product.onHand,
        reserved: 0,
      })
      .onConflictDoNothing({ target: inventory.productId });
  }

  console.log(
    `Seed complete: organization "Acme Trail Supply Co." (${SEED_ORGANIZATION_ID}) with ${SEED_PRODUCTS.length} products.`,
  );

  await pool.end();
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
