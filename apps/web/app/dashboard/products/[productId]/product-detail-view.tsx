'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { ProductStatusBadge, AvailabilityBadge } from '@/components/shared/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, isSessionExpired, type ProductDetail } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function ProductDetailView({ productId }: { productId: string }) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset during render (not inside the effect below) when the request identity changes —
  // see lib/organization-context.tsx for why this avoids react-hooks/set-state-in-effect.
  const requestKey = `${currentOrganizationId}:${productId}`;
  const [trackedRequestKey, setTrackedRequestKey] = useState(requestKey);
  if (trackedRequestKey !== requestKey) {
    setTrackedRequestKey(requestKey);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    if (!currentOrganizationId) {
      return;
    }
    const controller = new AbortController();
    api
      .getProduct(currentOrganizationId, productId, controller.signal)
      .then(({ product }) => setProduct(product))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (isSessionExpired(err)) {
          router.push('/login');
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError('Product not found in this organization.');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load this product.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentOrganizationId, productId, router]);

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !product) {
    return <ErrorState message={error ?? 'Could not load this product.'} />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={product.name} description={`SKU: ${product.sku}`} />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Details</CardTitle>
          <ProductStatusBadge status={product.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          {product.description && <p className="text-sm text-foreground">{product.description}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-medium">{formatPrice(product.unitPriceCents)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inventory</CardTitle>
          <AvailabilityBadge available={product.available} />
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">On hand</dt>
              <dd className="text-lg font-semibold tabular-nums">{product.onHand}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reserved</dt>
              <dd className="text-lg font-semibold tabular-nums">{product.reserved}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Available</dt>
              <dd className="text-lg font-semibold tabular-nums">{product.available}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
