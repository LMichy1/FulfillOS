import { products, inventory } from '../../src/database/schema';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization } from './setup/fixtures';
import { expectPgErrorCode } from './setup/pg-error';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

describe('products and inventory (integration)', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('rejects a duplicate SKU within the same organization, case/whitespace-insensitively', async () => {
    const org = await insertOrganization(db, 'SKU Org');
    await db.insert(products).values({
      organizationId: org.id,
      sku: 'WIDGET-1',
      name: 'Widget',
      unitPriceCents: 100,
    });

    await expectPgErrorCode(
      db.insert(products).values({
        organizationId: org.id,
        sku: '  widget-1  ',
        name: 'Widget Duplicate',
        unitPriceCents: 200,
      }),
      UNIQUE_VIOLATION,
    );
  });

  it('allows the identical SKU text in two different organizations', async () => {
    const orgA = await insertOrganization(db, 'Org A');
    const orgB = await insertOrganization(db, 'Org B');

    await db.insert(products).values({
      organizationId: orgA.id,
      sku: 'SHARED-SKU',
      name: 'A Product',
      unitPriceCents: 100,
    });

    await db.insert(products).values({
      organizationId: orgB.id,
      sku: 'SHARED-SKU',
      name: 'B Product',
      unitPriceCents: 150,
    });
  });

  it('rejects a negative on_hand or reserved quantity', async () => {
    const org = await insertOrganization(db, 'Negative Qty Org');
    const [product] = await db
      .insert(products)
      .values({
        organizationId: org.id,
        sku: 'NEG-1',
        name: 'Neg Product',
        unitPriceCents: 100,
      })
      .returning();

    await expectPgErrorCode(
      db.insert(inventory).values({
        organizationId: org.id,
        productId: product.id,
        onHand: -1,
        reserved: 0,
      }),
      CHECK_VIOLATION,
    );

    await expectPgErrorCode(
      db.insert(inventory).values({
        organizationId: org.id,
        productId: product.id,
        onHand: 5,
        reserved: -1,
      }),
      CHECK_VIOLATION,
    );
  });

  it('rejects reserved exceeding on_hand', async () => {
    const org = await insertOrganization(db, 'Overreserved Org');
    const [product] = await db
      .insert(products)
      .values({
        organizationId: org.id,
        sku: 'OVER-1',
        name: 'Over Product',
        unitPriceCents: 100,
      })
      .returning();

    await expectPgErrorCode(
      db.insert(inventory).values({
        organizationId: org.id,
        productId: product.id,
        onHand: 5,
        reserved: 6,
      }),
      CHECK_VIOLATION,
    );
  });

  it('allows reserved equal to on_hand (fully reserved, boundary case)', async () => {
    const org = await insertOrganization(db, 'Boundary Org');
    const [product] = await db
      .insert(products)
      .values({
        organizationId: org.id,
        sku: 'BOUND-1',
        name: 'Boundary Product',
        unitPriceCents: 100,
      })
      .returning();

    await db.insert(inventory).values({
      organizationId: org.id,
      productId: product.id,
      onHand: 5,
      reserved: 5,
    });
  });

  it('rejects an inventory row whose product belongs to a different organization', async () => {
    const productOwner = await insertOrganization(db, 'Product Owner Org');
    const otherOrg = await insertOrganization(db, 'Other Org');
    const [product] = await db
      .insert(products)
      .values({
        organizationId: productOwner.id,
        sku: 'CROSS-TENANT-1',
        name: 'Cross Tenant Product',
        unitPriceCents: 100,
      })
      .returning();

    // otherOrg claims this product as its own — the composite FK to products.(id,
    // organization_id) must reject it even though product.id genuinely exists.
    await expectPgErrorCode(
      db.insert(inventory).values({
        organizationId: otherOrg.id,
        productId: product.id,
        onHand: 10,
        reserved: 0,
      }),
      FOREIGN_KEY_VIOLATION,
    );
  });
});
