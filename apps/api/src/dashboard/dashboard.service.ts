import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants';
import type { Database } from '../database/database.module';
import { inventory, orders, products } from '../database/schema';

/**
 * A product is "low stock" when its available quantity (on_hand - reserved) is at or below
 * this threshold — including zero (out of stock counts as low stock; there is no separate
 * "out of stock" metric in this milestone). Defined once, here, rather than as a magic number
 * repeated in the frontend — see docs/architecture/frontend.md for how the dashboard surfaces
 * it.
 */
export const LOW_STOCK_THRESHOLD = 5;

export interface DashboardSummary {
  totalProducts: number;
  pendingOrders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  lowStockProducts: number;
}

/**
 * Every figure here is a database aggregate (COUNT(*), GROUP BY) scoped to one organization —
 * never a sum computed in application code over rows fetched for display. This is what keeps
 * the dashboard correct regardless of how many products or orders an organization has, and
 * keeps it independent of any list page's pagination.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getSummary(organizationId: string): Promise<DashboardSummary> {
    const [[productRow], orderRows, [lowStockRow]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(eq(products.organizationId, organizationId)),
      this.db
        .select({
          status: orders.status,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(eq(orders.organizationId, organizationId))
        .groupBy(orders.status),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventory)
        .where(
          and(
            eq(inventory.organizationId, organizationId),
            sql`(${inventory.onHand} - ${inventory.reserved}) <= ${LOW_STOCK_THRESHOLD}`,
          ),
        ),
    ]);

    const ordersByStatus = new Map(
      orderRows.map((row) => [row.status, row.count]),
    );

    return {
      totalProducts: productRow?.count ?? 0,
      pendingOrders: ordersByStatus.get('pending') ?? 0,
      fulfilledOrders: ordersByStatus.get('fulfilled') ?? 0,
      cancelledOrders: ordersByStatus.get('cancelled') ?? 0,
      lowStockProducts: lowStockRow?.count ?? 0,
    };
  }
}
