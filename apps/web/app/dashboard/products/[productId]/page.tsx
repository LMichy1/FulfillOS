import { ProductDetailView } from './product-detail-view';

/**
 * `params` is a Promise in this Next.js version (see
 * docs/architecture/frontend.md#server-and-client-component-boundaries) — awaited here, in a
 * plain Server Component, specifically so the actual data-fetching view below can stay a
 * Client Component (it needs the organization context, session-cookie-based API calls, and
 * interactive state a Server Component can't have).
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductDetailView productId={productId} />;
}
