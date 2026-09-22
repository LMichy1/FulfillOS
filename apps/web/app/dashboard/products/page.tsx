'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { PaginationControls } from '@/components/shared/pagination-controls';
import { ProductStatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, ApiError, isSessionExpired, type ProductSummary } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

const PAGE_SIZE = 20;

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export default function ProductsPage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganization();

  const [items, setItems] = useState<ProductSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const currentCursor = cursorStack[cursorStack.length - 1];

  // Reset during render (not inside the effect below) when the request identity changes —
  // see lib/organization-context.tsx for why this avoids react-hooks/set-state-in-effect.
  const requestKey = `${currentOrganizationId}:${currentCursor ?? ''}`;
  const [trackedRequestKey, setTrackedRequestKey] = useState(requestKey);
  if (trackedRequestKey !== requestKey) {
    setTrackedRequestKey(requestKey);
    setLoading(true);
    setError(null);
  }

  const fetchProducts = useCallback(
    (signal?: AbortSignal) => {
      if (!currentOrganizationId) {
        return;
      }
      api
        .listProducts(currentOrganizationId, { limit: PAGE_SIZE, cursor: currentCursor, signal })
        .then(({ items, nextCursor }) => {
          setItems(items);
          setNextCursor(nextCursor);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (isSessionExpired(err)) {
            router.push('/login');
            return;
          }
          setError(err instanceof ApiError ? err.message : 'Could not load products.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    // currentCursor is derived from cursorStack, included so paging re-fetches.
    [currentOrganizationId, currentCursor, router],
  );

  /** For an explicit user-triggered reload (the retry button) — called from an event handler,
   * so the synchronous setState calls here are fine; only a synchronous setState from inside a
   * useEffect body is the pattern to avoid. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const controller = new AbortController();
    fetchProducts(controller.signal);
    return () => controller.abort();
  }, [fetchProducts]);

  const canCreate = currentOrganization?.role === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Your organization's catalog."
        actions={
          canCreate ? (
            <Button nativeButton={false} render={<Link href="/dashboard/products/new" />}>
              New product
            </Button>
          ) : undefined
        }
      />

      {loading && <Skeleton className="h-64 w-full" />}

      {!loading && error && <ErrorState message={error} onRetry={() => reload()} />}

      {!loading && !error && items && items.length === 0 && cursorStack.length === 1 && (
        <EmptyState
          title="No products yet"
          description={
            canCreate
              ? 'Create your first product to start tracking inventory.'
              : "This organization hasn't added any products yet."
          }
          action={
            canCreate ? (
              <Button nativeButton={false} render={<Link href="/dashboard/products/new" />}>
                New product
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {product.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                    <TableCell>{formatPrice(product.unitPriceCents)}</TableCell>
                    <TableCell>
                      <ProductStatusBadge status={product.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls
            hasPrevious={cursorStack.length > 1}
            hasNext={Boolean(nextCursor)}
            onPrevious={() => setCursorStack((stack) => stack.slice(0, -1))}
            onNext={() => {
              if (nextCursor) setCursorStack((stack) => [...stack, nextCursor]);
            }}
          />
        </div>
      )}
    </div>
  );
}
