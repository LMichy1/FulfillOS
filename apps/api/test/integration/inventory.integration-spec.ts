import { eq } from 'drizzle-orm';
import { inventory, inventoryMovements } from '../../src/database/schema';
import { InventoryService } from '../../src/inventory/inventory.service';
import type { Database } from '../../src/database/database.module';
import { PG_INT4_MAX } from '../../src/common/postgres-int.util';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  type TestDatabase,
} from './setup/test-db';
import { insertOrganization, insertProduct } from './setup/fixtures';

describe('inventory adjustments (integration)', () => {
  let db: TestDatabase;
  let inventoryService: InventoryService;

  beforeAll(async () => {
    db = await getTestDb();
    inventoryService = new InventoryService(db as unknown as Database);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('initializes inventory via a positive adjustment when none exists yet', async () => {
    const org = await insertOrganization(db, 'Init Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'INIT-1',
      name: 'Init Product',
      unitPriceCents: 100,
    });

    const line = await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 10, reason: 'initial stock' },
      'init-key-1',
    );

    expect(line).toMatchObject({ onHand: 10, reserved: 0, available: 10 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(10);
  });

  it('applies a valid increase to existing inventory', async () => {
    const org = await insertOrganization(db, 'Increase Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'INC-1',
      name: 'Increase Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 10, reason: 'initial' },
      'inc-key-1',
    );

    const line = await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 5, reason: 'restock' },
      'inc-key-2',
    );

    expect(line.onHand).toBe(15);
    expect(line.available).toBe(15);
  });

  it('applies a valid decrease within bounds', async () => {
    const org = await insertOrganization(db, 'Decrease Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'DEC-1',
      name: 'Decrease Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 10, reason: 'initial' },
      'dec-key-1',
    );

    const line = await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: -3, reason: 'shrinkage' },
      'dec-key-2',
    );

    expect(line.onHand).toBe(7);
  });

  it('rejects a decrease that would drive on_hand negative, leaving stock unchanged', async () => {
    const org = await insertOrganization(db, 'Negative Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'NEG-1',
      name: 'Negative Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 5, reason: 'initial' },
      'neg-key-1',
    );

    await expect(
      inventoryService.adjustStock(
        org.id,
        { productId: product.id, delta: -10, reason: 'overreach' },
        'neg-key-2',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(5);
  });

  it('rejects a decrease that would drive on_hand below already-reserved stock', async () => {
    const org = await insertOrganization(db, 'Reserved Floor Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'FLOOR-1',
      name: 'Floor Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 10, reason: 'initial' },
      'floor-key-1',
    );
    // Simulate 4 units already reserved by a prior reservation (reservation logic itself is
    // covered in reservations.integration-spec.ts — this test only needs the resulting state).
    await db
      .update(inventory)
      .set({ reserved: 4 })
      .where(eq(inventory.productId, product.id));

    await expect(
      inventoryService.adjustStock(
        org.id,
        { productId: product.id, delta: -8, reason: 'too much shrinkage' },
        'floor-key-2',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(10);
    expect(row.reserved).toBe(4);
  });

  it('rejects an adjustment that would overflow the 32-bit on_hand column', async () => {
    const org = await insertOrganization(db, 'Overflow Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'OVERFLOW-1',
      name: 'Overflow Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: PG_INT4_MAX - 2, reason: 'initial' },
      'overflow-key-1',
    );

    await expect(
      inventoryService.adjustStock(
        org.id,
        { productId: product.id, delta: 10, reason: 'too much' },
        'overflow-key-2',
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects an adjustment for a product that does not belong to the organization', async () => {
    const org = await insertOrganization(db, 'Owner Org');
    const otherOrg = await insertOrganization(db, 'Other Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'TENANT-1',
      name: 'Tenant Product',
      unitPriceCents: 100,
    });

    await expect(
      inventoryService.adjustStock(
        otherOrg.id,
        { productId: product.id, delta: 5, reason: 'cross tenant' },
        'tenant-key-1',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('writes exactly one inventory_movements row per adjustment, atomically with the stock change', async () => {
    const org = await insertOrganization(db, 'Movement Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'MOVE-1',
      name: 'Movement Product',
      unitPriceCents: 100,
    });

    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 7, reason: 'stocktake' },
      'move-key-1',
    );

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movementType: 'on_hand_adjustment',
      onHandDelta: 7,
      reservedDelta: 0,
      reason: 'stocktake',
    });
  });

  it('lists inventory for an organization with available always computed server-side', async () => {
    const org = await insertOrganization(db, 'List Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'LIST-1',
      name: 'List Product',
      unitPriceCents: 100,
    });
    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 10, reason: 'initial' },
      'list-key-1',
    );
    // Directly poke `reserved` to prove `available` is always recomputed, never cached or
    // trusted from anywhere other than on_hand - reserved.
    await db
      .update(inventory)
      .set({ reserved: 3 })
      .where(eq(inventory.productId, product.id));

    const lines = await inventoryService.listInventory(org.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productId: product.id,
      onHand: 10,
      reserved: 3,
      available: 7,
    });
  });

  it('replays the original result for a retried adjustment with the same key and payload', async () => {
    const org = await insertOrganization(db, 'Idempotent Adjust Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'IDEMP-ADJ-1',
      name: 'Idempotent Adjust Product',
      unitPriceCents: 100,
    });
    const dto = { productId: product.id, delta: 6, reason: 'restock' };

    const first = await inventoryService.adjustStock(org.id, dto, 'same-key');
    const second = await inventoryService.adjustStock(org.id, dto, 'same-key');

    expect(second).toEqual(first);
    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    // Applied once, not twice — a second on_hand: 6 would be 12, not 6.
    expect(row.onHand).toBe(6);
  });

  it('rejects a reused idempotency key with a different payload', async () => {
    const org = await insertOrganization(db, 'Conflict Adjust Org');
    const product = await insertProduct(db, {
      organizationId: org.id,
      sku: 'CONFLICT-ADJ-1',
      name: 'Conflict Adjust Product',
      unitPriceCents: 100,
    });

    await inventoryService.adjustStock(
      org.id,
      { productId: product.id, delta: 6, reason: 'restock' },
      'reused-key',
    );

    await expect(
      inventoryService.adjustStock(
        org.id,
        { productId: product.id, delta: 9, reason: 'different restock' },
        'reused-key',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id));
    expect(row.onHand).toBe(6);
  });
});
