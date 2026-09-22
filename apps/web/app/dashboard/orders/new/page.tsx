'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2Icon } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useIdempotencyKey } from '@/lib/idempotency';

interface DraftLine {
  productId: string;
  quantity: number;
}

/** Products are fetched once, up to this many, for the line-item picker below — this page
 * does not paginate the picker itself (a known, documented simplification; see
 * docs/architecture/frontend.md#known-limitations). A catalog larger than this would need a
 * searchable combobox instead, which is out of scope for this milestone. */
const PRODUCT_PICKER_LIMIT = 100;

export default function NewOrderPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { key } = useIdempotencyKey();

  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [addLineError, setAddLineError] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentOrganizationId) {
      return;
    }
    const controller = new AbortController();
    api
      .listProducts(currentOrganizationId, {
        limit: PRODUCT_PICKER_LIMIT,
        signal: controller.signal,
      })
      .then(({ items }) => setProducts(items))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (isSessionExpired(err)) {
          router.push('/login');
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : 'Could not load products.');
      });
    return () => controller.abort();
  }, [currentOrganizationId, router]);

  const availableProducts = (products ?? []).filter(
    (product) => !lines.some((line) => line.productId === product.id),
  );

  function productName(productId: string): string {
    return products?.find((product) => product.id === productId)?.name ?? productId;
  }

  function handleAddLine() {
    setAddLineError(null);
    const quantity = Number(quantityInput);
    if (!selectedProductId) {
      setAddLineError('Choose a product.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setAddLineError('Quantity must be a whole number of at least 1.');
      return;
    }
    // A product can only appear once per request — the same rule the reservation endpoint
    // enforces server-side (see docs/architecture/order-lifecycle.md) — so this can never
    // actually trigger given availableProducts already excludes selected ones, but the check
    // stays here as the single source of truth for the rule rather than relying on the picker
    // alone.
    if (lines.some((line) => line.productId === selectedProductId)) {
      setAddLineError('That product is already on this order.');
      return;
    }
    setLines((current) => [...current, { productId: selectedProductId, quantity }]);
    setSelectedProductId('');
    setQuantityInput('1');
  }

  function handleRemoveLine(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  async function handleSubmit() {
    if (!currentOrganizationId || lines.length === 0) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { reservation } = await api.createReservation(
        currentOrganizationId,
        { items: lines },
        key,
      );
      router.push(`/dashboard/orders/${reservation.orderId}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Could not create this order. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="New order" />
        <ErrorState message={loadError} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="New order" description="Reserve stock across one or more products." />

      {products === null ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Add a line</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="product">Product</Label>
                <Select
                  value={selectedProductId}
                  onValueChange={(value) => setSelectedProductId(value ?? '')}
                >
                  <SelectTrigger id="product" className="w-full">
                    <SelectValue placeholder="Choose a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProducts.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        {products.length === 0
                          ? 'No products in this organization yet.'
                          : 'Every product is already on this order.'}
                      </div>
                    ) : (
                      availableProducts.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} ({product.sku})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-28">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  inputMode="numeric"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                />
              </div>
              <Button
                type="button"
                onClick={handleAddLine}
                disabled={availableProducts.length === 0}
              >
                Add line
              </Button>
            </CardContent>
            {addLineError && (
              <p role="alert" className="px-4 pb-4 text-sm text-destructive">
                {addLineError}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order lines</CardTitle>
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lines added yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.productId}>
                        <TableCell>{productName(line.productId)}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${productName(line.productId)}`}
                            onClick={() => handleRemoveLine(line.productId)}
                          >
                            <Trash2Icon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}

          <Button onClick={() => void handleSubmit()} disabled={lines.length === 0 || submitting}>
            {submitting ? 'Reserving…' : 'Create order'}
          </Button>
        </>
      )}
    </div>
  );
}
