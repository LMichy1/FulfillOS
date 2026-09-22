import { Badge } from '@/components/ui/badge';
import type { OrderStatus, ProductStatus } from '@/lib/api';

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

const ORDER_STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'outline'> = {
  pending: 'default',
  fulfilled: 'secondary',
  cancelled: 'outline',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={ORDER_STATUS_VARIANT[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Active',
  archived: 'Archived',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant={status === 'active' ? 'secondary' : 'outline'}>
      {PRODUCT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Threshold must match apps/api/src/dashboard/dashboard.service.ts's LOW_STOCK_THRESHOLD —
 * duplicated here only as a display concern (which badge to show), not as a second definition
 * of the business rule (the dashboard's low-stock count always comes from the API). */
const LOW_STOCK_THRESHOLD = 5;

export function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <Badge variant="destructive">Out of stock</Badge>;
  }
  if (available <= LOW_STOCK_THRESHOLD) {
    return <Badge variant="outline">Low stock</Badge>;
  }
  return <Badge variant="secondary">In stock</Badge>;
}
