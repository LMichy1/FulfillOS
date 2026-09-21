import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database, DbTransaction } from '../database/database.module';
import {
  auditLog,
  inventory,
  inventoryMovements,
  orderItems,
  orders,
  products,
  type Order,
} from '../database/schema';
import { canonicalFingerprint } from '../common/canonical-json.util';
import {
  unwrapOutcome,
  type OperationOutcome,
} from '../common/operation-outcome.util';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  IdempotencyKeyClaimedError,
  resolveIdempotencyConflict,
  type IdempotencyRequest,
} from '../idempotency/idempotency.util';
import type { CreateReservationDto } from './dto/create-reservation.dto';

export interface ReservationItemResult {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface ReservationResult {
  orderId: string;
  status: Order['status'];
  currency: string;
  items: ReservationItemResult[];
  // ISO 8601, not a Date: this value round-trips through the idempotency_keys.response_body
  // JSONB column on a replay, which serializes a Date to a string — returning a string
  // consistently on both the original and replayed path (rather than a Date on one and a
  // string on the other) is what makes "returns persisted outcomes for identical retries"
  // (see docs/architecture/order-lifecycle.md#idempotency) actually true, not just
  // true-after-JSON-serialization.
  createdAt: string;
}

export interface ReleaseResult {
  orderId: string;
  status: Order['status'];
  cancelledAt: string | null;
}

export interface FulfillResult {
  orderId: string;
  status: Order['status'];
  fulfilledAt: string | null;
}

const CREATE_OPERATION = 'reservation.create';
const RELEASE_OPERATION = 'reservation.release';
const FULFILL_OPERATION = 'order.fulfill';

@Injectable()
export class ReservationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Creates a multi-product reservation — an `orders` row in `pending` status plus one
   * `order_items` row per line — atomically with the inventory `reserved` increments that
   * back it. See docs/architecture/inventory.md#reservation-lifecycle for why this reuses
   * the existing `orders`/`order_items` tables rather than a new `reservations` table, and
   * #lock-order for why inventory rows are locked in ascending `product_id` order.
   */
  async createReservation(
    organizationId: string,
    userId: string,
    dto: CreateReservationDto,
    idempotencyKey: string,
  ): Promise<ReservationResult> {
    // Steps 3-4 of the reservation sequence (validate products belong to this organization;
    // reject duplicate lines) run before the transaction starts and before the idempotency key
    // is claimed: both are pure functions of the request body plus a read-only lookup, with no
    // side effect that would need idempotent replay — see
    // docs/architecture/inventory.md#idempotency.
    const productIds = dto.items.map((item) => item.productId);
    const uniqueProductIds = new Set(productIds);
    if (uniqueProductIds.size !== productIds.length) {
      throw new BadRequestException(
        'Duplicate product lines are not allowed in a single reservation request.',
      );
    }

    const matchingProducts = await this.db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.organizationId, organizationId),
          inArray(products.id, productIds),
        ),
      );
    if (matchingProducts.length !== uniqueProductIds.size) {
      throw new BadRequestException(
        'One or more products do not exist in this organization.',
      );
    }

    const idempotencyRequest: IdempotencyRequest = {
      organizationId,
      operation: CREATE_OPERATION,
      idempotencyKey,
      requestFingerprint: canonicalFingerprint(dto),
    };

    try {
      const outcome = await this.db.transaction(async (tx) => {
        await claimIdempotencyKey(tx, idempotencyRequest);
        const result = await this.reserveStock(tx, organizationId, userId, dto);
        await completeIdempotencyKey(tx, idempotencyRequest, result);
        return result;
      });
      return unwrapOutcome(outcome);
    } catch (error) {
      if (error instanceof IdempotencyKeyClaimedError) {
        const outcome = await resolveIdempotencyConflict<ReservationResult>(
          this.db,
          idempotencyRequest,
        );
        return unwrapOutcome(outcome);
      }
      throw error;
    }
  }

  /** Steps 5-11: lock, validate stock, and write — run inside the caller's transaction. */
  private async reserveStock(
    tx: DbTransaction,
    organizationId: string,
    userId: string,
    dto: CreateReservationDto,
  ): Promise<OperationOutcome<ReservationResult>> {
    const productIds = dto.items.map((item) => item.productId);

    // Lock only the inventory rows (not the joined products rows) in ascending product_id
    // order — the deterministic order that prevents two concurrent multi-product
    // reservations from deadlocking each other (see ADR-002).
    const lockedRows = await tx
      .select({
        id: inventory.id,
        productId: inventory.productId,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
        unitPriceCents: products.unitPriceCents,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(
        and(
          eq(inventory.organizationId, organizationId),
          inArray(inventory.productId, productIds),
        ),
      )
      .orderBy(asc(inventory.productId))
      .for('update', { of: inventory });

    const lockedByProductId = new Map(
      lockedRows.map((row) => [row.productId, row]),
    );

    const shortfalls: Array<{
      productId: string;
      requested: number;
      available: number;
    }> = [];
    for (const item of dto.items) {
      const row = lockedByProductId.get(item.productId);
      const available = row ? row.onHand - row.reserved : 0;
      if (available < item.quantity) {
        shortfalls.push({
          productId: item.productId,
          requested: item.quantity,
          available,
        });
      }
    }

    if (shortfalls.length > 0) {
      return {
        ok: false,
        status: 409,
        body: {
          message: 'Insufficient stock for one or more requested products.',
          shortfalls,
        },
      };
    }

    for (const item of dto.items) {
      const row = lockedByProductId.get(item.productId)!;
      await tx
        .update(inventory)
        .set({ reserved: row.reserved + item.quantity, updatedAt: new Date() })
        .where(eq(inventory.id, row.id));
    }

    const currency = dto.currency ?? 'USD';
    const [order] = await tx
      .insert(orders)
      .values({ organizationId, status: 'pending', currency })
      .returning();

    await tx.insert(orderItems).values(
      dto.items.map((item) => ({
        organizationId,
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPriceCents: lockedByProductId.get(item.productId)!.unitPriceCents,
      })),
    );

    await tx.insert(inventoryMovements).values(
      dto.items.map((item) => ({
        organizationId,
        productId: item.productId,
        movementType: 'reservation' as const,
        onHandDelta: 0,
        reservedDelta: item.quantity,
        reason: 'Reservation created',
        reference: { orderId: order.id },
      })),
    );

    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: userId,
      action: 'reservation.create',
      resourceType: 'order',
      resourceId: order.id,
      metadata: { items: dto.items },
    });

    return {
      ok: true,
      status: 201,
      body: {
        orderId: order.id,
        status: order.status,
        currency: order.currency,
        items: dto.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: lockedByProductId.get(item.productId)!.unitPriceCents,
        })),
        createdAt: order.createdAt.toISOString(),
      },
    };
  }

  /**
   * Releases (cancels) a `pending` reservation, decrementing `reserved` back down by exactly
   * the quantities that were reserved. The `pending` -> `cancelled` transition is done as a
   * single conditional `UPDATE ... WHERE status = 'pending'`, which is what makes concurrent
   * or repeated release attempts safe: only the request that actually flips the row from
   * `pending` gets to release any stock at all — see
   * docs/architecture/inventory.md#reservation-lifecycle.
   */
  async releaseReservation(
    organizationId: string,
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<ReleaseResult> {
    const idempotencyRequest: IdempotencyRequest = {
      organizationId,
      operation: RELEASE_OPERATION,
      idempotencyKey,
      requestFingerprint: canonicalFingerprint({ orderId }),
    };

    try {
      const outcome = await this.db.transaction(async (tx) => {
        await claimIdempotencyKey(tx, idempotencyRequest);
        const result = await this.releaseStock(
          tx,
          organizationId,
          userId,
          orderId,
        );
        await completeIdempotencyKey(tx, idempotencyRequest, result);
        return result;
      });
      return unwrapOutcome(outcome);
    } catch (error) {
      if (error instanceof IdempotencyKeyClaimedError) {
        const outcome = await resolveIdempotencyConflict<ReleaseResult>(
          this.db,
          idempotencyRequest,
        );
        return unwrapOutcome(outcome);
      }
      throw error;
    }
  }

  private async releaseStock(
    tx: DbTransaction,
    organizationId: string,
    userId: string,
    orderId: string,
  ): Promise<OperationOutcome<ReleaseResult>> {
    const [cancelled] = await tx
      .update(orders)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, organizationId),
          eq(orders.status, 'pending'),
        ),
      )
      .returning();

    if (!cancelled) {
      const [existing] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.organizationId, organizationId),
          ),
        );

      if (!existing) {
        return {
          ok: false,
          status: 404,
          body: { message: 'Reservation not found in this organization.' },
        };
      }
      return {
        ok: false,
        status: 409,
        body: {
          message: `Reservation cannot be released: it is already "${existing.status}".`,
        },
      };
    }

    const items = await tx
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productId));

    const productIds = items.map((item) => item.productId);
    const lockedRows = await tx
      .select({
        id: inventory.id,
        productId: inventory.productId,
        reserved: inventory.reserved,
      })
      .from(inventory)
      .where(
        and(
          eq(inventory.organizationId, organizationId),
          inArray(inventory.productId, productIds),
        ),
      )
      .orderBy(asc(inventory.productId))
      .for('update', { of: inventory });
    const lockedByProductId = new Map(
      lockedRows.map((row) => [row.productId, row]),
    );

    for (const item of items) {
      const row = lockedByProductId.get(item.productId);
      // Invariant, not a normal business rejection: the reservation that is being released
      // created these exact reserved quantities, so the inventory row must still exist and
      // still hold at least this much reserved stock. A stock adjustment can never reduce
      // `reserved` (only `on_hand`), so this cannot happen without a prior bug — fail loudly
      // rather than silently under-releasing.
      if (!row || row.reserved < item.quantity) {
        throw new Error(
          `Invariant violated: cannot release ${item.quantity} reserved unit(s) of product ${item.productId} — locked inventory row shows only ${row?.reserved ?? 0} reserved.`,
        );
      }
      await tx
        .update(inventory)
        .set({ reserved: row.reserved - item.quantity, updatedAt: new Date() })
        .where(eq(inventory.id, row.id));
    }

    if (items.length > 0) {
      await tx.insert(inventoryMovements).values(
        items.map((item) => ({
          organizationId,
          productId: item.productId,
          movementType: 'release' as const,
          onHandDelta: 0,
          reservedDelta: -item.quantity,
          reason: 'Reservation released',
          reference: { orderId },
        })),
      );
    }

    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: userId,
      action: 'reservation.release',
      resourceType: 'order',
      resourceId: orderId,
      metadata: {},
    });

    return {
      ok: true,
      status: 200,
      body: {
        orderId: cancelled.id,
        status: cancelled.status,
        cancelledAt: cancelled.cancelledAt
          ? cancelled.cancelledAt.toISOString()
          : null,
      },
    };
  }

  /**
   * Fulfills a `pending` reservation: consumes the previously reserved stock permanently,
   * decrementing both `on_hand` and `reserved` by the order's item quantities (so `available`
   * is unchanged — the stock was already unavailable to other reservations from the moment it
   * was reserved). This is the `pending -> fulfilled` transition Milestone 3 explicitly
   * deferred — see docs/architecture/order-lifecycle.md#fulfillment.
   *
   * Structurally identical to `releaseReservation` above (same conditional-update-on-`orders`
   * "exactly once" mechanism, same ascending-`product_id` lock order over the order's
   * `order_items`, same idempotency wrapping) — the only difference is the inventory math and
   * the movement type recorded. This is what guarantees a concurrent fulfill-and-cancel race
   * for the same order can never both succeed: both transitions compete for the same
   * conditional `UPDATE ... WHERE status = 'pending'` on the same order row, and Postgres's
   * row-level locking serializes them.
   */
  async fulfillOrder(
    organizationId: string,
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<FulfillResult> {
    const idempotencyRequest: IdempotencyRequest = {
      organizationId,
      operation: FULFILL_OPERATION,
      idempotencyKey,
      requestFingerprint: canonicalFingerprint({ orderId }),
    };

    try {
      const outcome = await this.db.transaction(async (tx) => {
        await claimIdempotencyKey(tx, idempotencyRequest);
        const result = await this.fulfillStock(
          tx,
          organizationId,
          userId,
          orderId,
        );
        await completeIdempotencyKey(tx, idempotencyRequest, result);
        return result;
      });
      return unwrapOutcome(outcome);
    } catch (error) {
      if (error instanceof IdempotencyKeyClaimedError) {
        const outcome = await resolveIdempotencyConflict<FulfillResult>(
          this.db,
          idempotencyRequest,
        );
        return unwrapOutcome(outcome);
      }
      throw error;
    }
  }

  private async fulfillStock(
    tx: DbTransaction,
    organizationId: string,
    userId: string,
    orderId: string,
  ): Promise<OperationOutcome<FulfillResult>> {
    const [fulfilled] = await tx
      .update(orders)
      .set({
        status: 'fulfilled',
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, organizationId),
          eq(orders.status, 'pending'),
        ),
      )
      .returning();

    if (!fulfilled) {
      const [existing] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.organizationId, organizationId),
          ),
        );

      if (!existing) {
        return {
          ok: false,
          status: 404,
          body: { message: 'Order not found in this organization.' },
        };
      }
      return {
        ok: false,
        status: 409,
        body: {
          message: `Order cannot be fulfilled: it is already "${existing.status}".`,
        },
      };
    }

    const items = await tx
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productId));

    const productIds = items.map((item) => item.productId);
    const lockedRows = await tx
      .select({
        id: inventory.id,
        productId: inventory.productId,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
      })
      .from(inventory)
      .where(
        and(
          eq(inventory.organizationId, organizationId),
          inArray(inventory.productId, productIds),
        ),
      )
      .orderBy(asc(inventory.productId))
      .for('update', { of: inventory });
    const lockedByProductId = new Map(
      lockedRows.map((row) => [row.productId, row]),
    );

    for (const item of items) {
      const row = lockedByProductId.get(item.productId);
      // Invariant, not a normal business rejection: the reservation being fulfilled created
      // these exact reserved quantities against this exact on_hand, so the inventory row must
      // still hold at least this much of both. This cannot happen without a prior bug — fail
      // loudly rather than silently under-fulfilling.
      if (!row || row.reserved < item.quantity || row.onHand < item.quantity) {
        throw new Error(
          `Invariant violated: cannot fulfill ${item.quantity} unit(s) of product ${item.productId} — locked inventory row shows on_hand=${row?.onHand ?? 0}, reserved=${row?.reserved ?? 0}.`,
        );
      }
      await tx
        .update(inventory)
        .set({
          onHand: row.onHand - item.quantity,
          reserved: row.reserved - item.quantity,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, row.id));
    }

    if (items.length > 0) {
      await tx.insert(inventoryMovements).values(
        items.map((item) => ({
          organizationId,
          productId: item.productId,
          movementType: 'fulfillment' as const,
          onHandDelta: -item.quantity,
          reservedDelta: -item.quantity,
          reason: 'Order fulfilled',
          reference: { orderId },
        })),
      );
    }

    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: userId,
      action: 'order.fulfill',
      resourceType: 'order',
      resourceId: orderId,
      metadata: {},
    });

    return {
      ok: true,
      status: 200,
      body: {
        orderId: fulfilled.id,
        status: fulfilled.status,
        fulfilledAt: fulfilled.fulfilledAt
          ? fulfilled.fulfilledAt.toISOString()
          : null,
      },
    };
  }
}
