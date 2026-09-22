import { OrderDetailView } from './order-detail-view';

/** See app/dashboard/products/[productId]/page.tsx for why this is a plain Server Component
 * that just awaits `params` and hands off to a Client Component. */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderDetailView orderId={orderId} />;
}
