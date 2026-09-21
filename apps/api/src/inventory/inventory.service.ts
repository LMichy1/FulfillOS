import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database, DbTransaction } from '../database/database.module';
import { inventory, inventoryMovements, products } from '../database/schema';
import { canonicalFingerprint } from '../common/canonical-json.util';
import {
  unwrapOutcome,
  type OperationOutcome,
} from '../common/operation-outcome.util';
import { PG_INT4_MAX } from '../common/postgres-int.util';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  IdempotencyKeyClaimedError,
  resolveIdempotencyConflict,
  type IdempotencyRequest,
} from '../idempotency/idempotency.util';
import type { AdjustInventoryDto } from './dto/adjust-inventory.dto';

export interface InventoryLine {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
}

const ADJUST_OPERATION = 'inventory.adjust';

@Injectable()
export class InventoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every inventory row for the organization, joined with the product it belongs to.
   * `available` is always computed here (`on_hand - reserved`) — it is never stored, and a
   * client can never supply or override it. */
  async listInventory(organizationId: string): Promise<InventoryLine[]> {
    const rows = await this.db
      .select({
        productId: inventory.productId,
        sku: products.sku,
        name: products.name,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(eq(inventory.organizationId, organizationId))
      .orderBy(asc(products.sku));

    return rows.map((row) => ({
      ...row,
      available: row.onHand - row.reserved,
    }));
  }

  /**
   * Applies a signed on-hand adjustment, guarded by the shared idempotency mechanism (see
   * docs/architecture/inventory.md#idempotency). A repeated request with the same
   * organization/operation/idempotency-key and the same payload replays the original result
   * without adjusting stock a second time.
   */
  async adjustStock(
    organizationId: string,
    dto: AdjustInventoryDto,
    idempotencyKey: string,
  ): Promise<InventoryLine> {
    const idempotencyRequest: IdempotencyRequest = {
      organizationId,
      operation: ADJUST_OPERATION,
      idempotencyKey,
      requestFingerprint: canonicalFingerprint(dto),
    };

    try {
      const outcome = await this.db.transaction(async (tx) => {
        await claimIdempotencyKey(tx, idempotencyRequest);
        const result = await this.applyAdjustment(tx, organizationId, dto);
        await completeIdempotencyKey(tx, idempotencyRequest, result);
        return result;
      });
      return unwrapOutcome(outcome);
    } catch (error) {
      if (error instanceof IdempotencyKeyClaimedError) {
        const outcome = await resolveIdempotencyConflict<InventoryLine>(
          this.db,
          idempotencyRequest,
        );
        return unwrapOutcome(outcome);
      }
      throw error;
    }
  }

  /**
   * The actual adjustment, run inside the caller's transaction. Returns an `OperationOutcome`
   * rather than throwing for any expected rejection (product not in this org, adjustment would
   * drive stock negative or below what's reserved, overflow) — see
   * `common/operation-outcome.util.ts` for why: a clean rejection must still let the
   * transaction commit so its idempotency record persists.
   */
  private async applyAdjustment(
    tx: DbTransaction,
    organizationId: string,
    dto: AdjustInventoryDto,
  ): Promise<OperationOutcome<InventoryLine>> {
    const [product] = await tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.id, dto.productId),
          eq(products.organizationId, organizationId),
        ),
      );

    if (!product) {
      return {
        ok: false,
        status: 404,
        body: { message: 'Product not found in this organization.' },
      };
    }

    let row = (
      await tx
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.productId, dto.productId),
            eq(inventory.organizationId, organizationId),
          ),
        )
        .for('update')
    )[0];

    if (!row) {
      if (dto.delta < 0) {
        return {
          ok: false,
          status: 409,
          body: {
            message:
              'Cannot reduce stock for a product with no existing inventory record.',
          },
        };
      }
      [row] = await tx
        .insert(inventory)
        .values({
          organizationId,
          productId: dto.productId,
          onHand: dto.delta,
          reserved: 0,
        })
        .returning();
    } else {
      const newOnHand = row.onHand + dto.delta;

      if (newOnHand < 0) {
        return {
          ok: false,
          status: 409,
          body: {
            message: 'Adjustment would drive on-hand stock negative.',
            onHand: row.onHand,
            delta: dto.delta,
          },
        };
      }
      if (newOnHand < row.reserved) {
        return {
          ok: false,
          status: 409,
          body: {
            message:
              'Adjustment would reduce on-hand stock below already-reserved stock.',
            onHand: row.onHand,
            reserved: row.reserved,
            delta: dto.delta,
          },
        };
      }
      if (newOnHand > PG_INT4_MAX) {
        return {
          ok: false,
          status: 422,
          body: {
            message:
              'Adjustment would overflow the maximum representable stock quantity.',
          },
        };
      }

      [row] = await tx
        .update(inventory)
        .set({ onHand: newOnHand, updatedAt: new Date() })
        .where(eq(inventory.id, row.id))
        .returning();
    }

    await tx.insert(inventoryMovements).values({
      organizationId,
      productId: dto.productId,
      movementType: 'on_hand_adjustment',
      onHandDelta: dto.delta,
      reservedDelta: 0,
      reason: dto.reason,
      reference: {},
    });

    return {
      ok: true,
      status: 200,
      body: {
        productId: dto.productId,
        sku: product.sku,
        name: product.name,
        onHand: row.onHand,
        reserved: row.reserved,
        available: row.onHand - row.reserved,
      },
    };
  }
}
