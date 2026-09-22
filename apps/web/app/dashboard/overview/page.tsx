'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PackageIcon,
  ClockIcon,
  CheckCircle2Icon,
  XCircleIcon,
  AlertTriangleIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { api, ApiError, isSessionExpired, type DashboardSummary } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

interface Metric {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}

function metricsFrom(summary: DashboardSummary): Metric[] {
  return [
    { label: 'Total products', value: summary.totalProducts, icon: PackageIcon },
    { label: 'Pending orders', value: summary.pendingOrders, icon: ClockIcon },
    { label: 'Fulfilled orders', value: summary.fulfilledOrders, icon: CheckCircle2Icon },
    { label: 'Cancelled orders', value: summary.cancelledOrders, icon: XCircleIcon },
    { label: 'Low-stock products', value: summary.lowStockProducts, icon: AlertTriangleIcon },
  ];
}

export default function OverviewPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset during render (not inside the effect below) when the organization changes — see
  // lib/organization-context.tsx for why this avoids react-hooks/set-state-in-effect.
  const requestKey = currentOrganizationId ?? '';
  const [trackedRequestKey, setTrackedRequestKey] = useState(requestKey);
  if (trackedRequestKey !== requestKey) {
    setTrackedRequestKey(requestKey);
    setLoading(true);
    setError(null);
  }

  const fetchSummary = useCallback(
    (signal?: AbortSignal) => {
      if (!currentOrganizationId) {
        return;
      }
      api
        .getDashboardSummary(currentOrganizationId, signal)
        .then(({ summary }) => setSummary(summary))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (isSessionExpired(err)) {
            router.push('/login');
            return;
          }
          setError(err instanceof ApiError ? err.message : 'Could not load the dashboard summary.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [currentOrganizationId, router],
  );

  /** For an explicit user-triggered reload (the retry button) — called from an event handler,
   * so the synchronous setState calls here are fine; only a synchronous setState from inside a
   * useEffect body is the pattern to avoid. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal);
    return () => controller.abort();
  }, [fetchSummary]);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="An operational summary of your organization." />

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {!loading && error && <ErrorState message={error} onRetry={() => reload()} />}

      {!loading && !error && summary && summary.totalProducts === 0 && (
        <EmptyState
          title="Nothing here yet"
          description="Create your first product to start tracking inventory and orders."
          action={
            <Button nativeButton={false} render={<Link href="/dashboard/products/new" />}>
              Create a product
            </Button>
          }
        />
      )}

      {!loading && !error && summary && summary.totalProducts > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {metricsFrom(summary).map((metric) => (
            <Card key={metric.label}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metric.label}
                </CardTitle>
                <metric.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{metric.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
