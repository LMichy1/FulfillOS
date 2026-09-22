'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { AvailabilityBadge } from '@/components/shared/status-badge';
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
import { api, ApiError, isSessionExpired, type InventoryLine } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';
import { AdjustInventoryDialog } from './adjust-inventory-dialog';

export default function InventoryPage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganization();
  const [lines, setLines] = useState<InventoryLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjustingLine, setAdjustingLine] = useState<InventoryLine | null>(null);

  // Reset during render (not inside the effect below) when the organization changes — see
  // lib/organization-context.tsx for why this avoids react-hooks/set-state-in-effect.
  const requestKey = currentOrganizationId ?? '';
  const [trackedRequestKey, setTrackedRequestKey] = useState(requestKey);
  if (trackedRequestKey !== requestKey) {
    setTrackedRequestKey(requestKey);
    setLoading(true);
    setError(null);
  }

  const fetchInventory = useCallback(
    (signal?: AbortSignal) => {
      if (!currentOrganizationId) {
        return;
      }
      api
        .listInventory(currentOrganizationId, signal)
        .then(({ inventory }) => setLines(inventory))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (isSessionExpired(err)) {
            router.push('/login');
            return;
          }
          setError(err instanceof ApiError ? err.message : 'Could not load inventory.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [currentOrganizationId, router],
  );

  /** For an explicit user-triggered reload (retry button, after a successful adjustment) —
   * called from an event handler, so the synchronous setState calls here are fine; only a
   * synchronous setState from inside a useEffect body is the pattern to avoid. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchInventory();
  }, [fetchInventory]);

  useEffect(() => {
    const controller = new AbortController();
    fetchInventory(controller.signal);
    return () => controller.abort();
  }, [fetchInventory]);

  const canAdjust = currentOrganization?.role === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Stock levels across your catalog." />

      {loading && <Skeleton className="h-64 w-full" />}

      {!loading && error && <ErrorState message={error} onRetry={() => reload()} />}

      {!loading && !error && lines && lines.length === 0 && (
        <EmptyState
          title="No inventory yet"
          description="Inventory appears here once you create a product."
        />
      )}

      {!loading && !error && lines && lines.length > 0 && (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead>
                {canAdjust && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.productId}>
                  <TableCell className="font-medium">{line.name}</TableCell>
                  <TableCell className="text-muted-foreground">{line.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.onHand}</TableCell>
                  {/* reserved is display-only — there is no control anywhere on this page that
                      submits a value for it; it can only change via reservation/fulfillment/
                      cancellation, not a direct edit. */}
                  <TableCell className="text-right tabular-nums">{line.reserved}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.available}</TableCell>
                  <TableCell>
                    <AvailabilityBadge available={line.available} />
                  </TableCell>
                  {canAdjust && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setAdjustingLine(line)}>
                        Adjust
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adjustingLine && currentOrganizationId && (
        <AdjustInventoryDialog
          open={Boolean(adjustingLine)}
          onOpenChange={(open) => {
            if (!open) setAdjustingLine(null);
          }}
          organizationId={currentOrganizationId}
          line={adjustingLine}
          onAdjusted={() => reload()}
        />
      )}
    </div>
  );
}
