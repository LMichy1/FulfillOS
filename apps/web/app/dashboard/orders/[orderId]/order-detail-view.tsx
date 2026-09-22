'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { OrderStatusBadge } from '@/components/shared/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, ApiError, isSessionExpired, type OrderDetail } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';
import { useIdempotencyKey } from '@/lib/idempotency';

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function OrderDetailView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const fulfillKey = useIdempotencyKey();
  const cancelKey = useIdempotencyKey();

  // Reset during render (not inside the effect below) when the request identity changes —
  // see lib/organization-context.tsx for why this avoids react-hooks/set-state-in-effect.
  const requestKey = `${currentOrganizationId}:${orderId}`;
  const [trackedRequestKey, setTrackedRequestKey] = useState(requestKey);
  if (trackedRequestKey !== requestKey) {
    setTrackedRequestKey(requestKey);
    setLoading(true);
    setError(null);
  }

  const fetchOrder = useCallback(
    (signal?: AbortSignal) => {
      if (!currentOrganizationId) {
        return;
      }
      api
        .getOrder(currentOrganizationId, orderId, signal)
        .then(({ order }) => setOrder(order))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (isSessionExpired(err)) {
            router.push('/login');
            return;
          }
          if (err instanceof ApiError && err.status === 404) {
            setError('Order not found in this organization.');
            return;
          }
          setError(err instanceof ApiError ? err.message : 'Could not load this order.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [currentOrganizationId, orderId, router],
  );

  /** For an explicit reload after a fulfill/cancel attempt (success or failure) — called from
   * an event-handler-driven async function, so the synchronous setState calls here are fine;
   * only a synchronous setState from inside a useEffect body is the pattern to avoid. */
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrder(controller.signal);
    return () => controller.abort();
  }, [fetchOrder]);

  async function handleFulfill() {
    if (!currentOrganizationId) return;
    try {
      await api.fulfillOrder(currentOrganizationId, orderId, fulfillKey.key);
      setConflictNotice(null);
    } catch (err) {
      // A 409 here means the order was no longer pending by the time this request reached
      // the server — most likely someone else (or another tab) already fulfilled or
      // cancelled it. Reload authoritative data so the UI reflects what actually happened,
      // rather than trusting this client's stale view of the order.
      if (err instanceof ApiError && err.status === 409) {
        setConflictNotice(err.message);
      }
      throw err;
    } finally {
      load();
    }
  }

  async function handleCancel() {
    if (!currentOrganizationId) return;
    try {
      await api.cancelOrder(currentOrganizationId, orderId, cancelKey.key);
      setConflictNotice(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictNotice(err.message);
      }
      throw err;
    } finally {
      load();
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !order) {
    return <ErrorState message={error ?? 'Could not load this order.'} />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={`Order ${order.id.slice(0, 8)}`}
        description={`Created ${formatDate(order.createdAt)}`}
      />

      {conflictNotice && (
        <Alert variant="destructive">
          <AlertTitle>This order changed</AlertTitle>
          <AlertDescription>{conflictNotice}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Status</CardTitle>
          <OrderStatusBadge status={order.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Currency</dt>
              <dd className="font-medium">{order.currency}</dd>
            </div>
            {order.fulfilledAt && (
              <div>
                <dt className="text-muted-foreground">Fulfilled</dt>
                <dd className="font-medium">{formatDate(order.fulfilledAt)}</dd>
              </div>
            )}
            {order.cancelledAt && (
              <div>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd className="font-medium">{formatDate(order.cancelledAt)}</dd>
              </div>
            )}
          </dl>

          {order.status === 'pending' && (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  fulfillKey.renew();
                  setFulfillOpen(true);
                }}
              >
                Fulfill order
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  cancelKey.renew();
                  setCancelOpen(true);
                }}
              >
                Cancel order
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPrice(item.unitPriceCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={fulfillOpen}
        onOpenChange={setFulfillOpen}
        title="Fulfill this order?"
        description="This consumes the reserved stock permanently and cannot be undone."
        confirmLabel="Fulfill order"
        onConfirm={handleFulfill}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this order?"
        description="This releases the reserved stock back to available inventory and cannot be undone."
        confirmLabel="Cancel order"
        destructive
        onConfirm={handleCancel}
      />
    </div>
  );
}
