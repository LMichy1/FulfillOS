'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { PaginationControls } from '@/components/shared/pagination-controls';
import { OrderStatusBadge } from '@/components/shared/status-badge';
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
import { api, ApiError, isSessionExpired, type OrderSummary } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

const PAGE_SIZE = 20;

export default function OrdersPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();

  const [items, setItems] = useState<OrderSummary[] | null>(null);
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

  const fetchOrders = useCallback(
    (signal?: AbortSignal) => {
      if (!currentOrganizationId) {
        return;
      }
      api
        .listOrders(currentOrganizationId, { limit: PAGE_SIZE, cursor: currentCursor, signal })
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
          setError(err instanceof ApiError ? err.message : 'Could not load orders.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [currentOrganizationId, currentCursor, router],
  );

  /** For an explicit user-triggered reload (the retry button) — called from an event handler,
   * so the synchronous setState calls here are fine; only a synchronous setState from inside a
   * useEffect body is the pattern to avoid. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrders(controller.signal);
    return () => controller.abort();
  }, [fetchOrders]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Reservations and their fulfillment status."
        actions={
          <Button nativeButton={false} render={<Link href="/dashboard/orders/new" />}>
            New order
          </Button>
        }
      />

      {loading && <Skeleton className="h-64 w-full" />}

      {!loading && error && <ErrorState message={error} onRetry={() => reload()} />}

      {!loading && !error && items && items.length === 0 && cursorStack.length === 1 && (
        <EmptyState
          title="No orders yet"
          description="Reserve stock against a product to create your first order."
          action={
            <Button nativeButton={false} render={<Link href="/dashboard/orders/new" />}>
              New order
            </Button>
          }
        />
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/orders/${order.id}`}
                        className="font-mono text-xs text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {order.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{order.currency}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(order.createdAt)}
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
