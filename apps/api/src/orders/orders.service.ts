import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import { orderItems, orders, products, type Order } from '../database/schema';
import {
  decodeCursor,
  keysetBefore,
  normalizeLimit,
  paginate,
  type CursorPage,
} from '../common/pagination.util';
import {
  ReservationsService,
  type FulfillResult,
  type ReleaseResult,
} from '../reservations/reservations.service';

export interface OrderSummary {
  id: string;
  status: Order['status'];
  currency: string;
  createdAt: Date;
}

export interface OrderItemDetail {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDetail extends OrderSummary {
  updatedAt: Date;
  cancelledAt: Date | null;
  fulfilledAt: Date | null;
  items: OrderItemDetail[];
}

/**
 * Read-side (list/get) for orders lives here; the write-side state transitions
 * (fulfill/cancel) are delegated to `ReservationsService`, which already owns them from
 * Milestone 3 — this service does not reimplement either. See
 * docs/architecture/order-lifecycle.md#fulfillment-vs-cancellation.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly reservationsService: ReservationsService,
  ) {}

  async listOrders(
    organizationId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<CursorPage<OrderSummary>> {
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) {
      throw new BadRequestException('Invalid pagination cursor.');
    }

    const rows = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        currency: orders.currency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        cursor
          ? and(
              eq(orders.organizationId, organizationId),
              keysetBefore(orders.createdAt, orders.id, cursor),
            )
          : eq(orders.organizationId, organizationId),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);

    return paginate(rows, limit);
  }

  async getOrder(
    organizationId: string,
    orderId: string,
  ): Promise<OrderDetail> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(
        and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)),
      );

    if (!order) {
      throw new NotFoundException('Order not found in this organization.');
    }

    const items = await this.db
      .select({
        productId: orderItems.productId,
        sku: products.sku,
        name: products.name,
        quantity: orderItems.quantity,
        unitPriceCents: orderItems.unitPriceCents,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(orderItems.productId);

    return {
      id: order.id,
      status: order.status,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
      fulfilledAt: order.fulfilledAt,
      items,
    };
  }

  async fulfillOrder(
    organizationId: string,
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<FulfillResult> {
    return this.reservationsService.fulfillOrder(
      organizationId,
      userId,
      orderId,
      idempotencyKey,
    );
  }

  async cancelOrder(
    organizationId: string,
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<ReleaseResult> {
    return this.reservationsService.releaseReservation(
      organizationId,
      userId,
      orderId,
      idempotencyKey,
    );
  }
}
