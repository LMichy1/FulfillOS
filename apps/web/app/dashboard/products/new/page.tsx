'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

const productFormSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required.').max(64, 'SKU must be at most 64 characters.'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(200, 'Name must be at most 200 characters.'),
  description: z.string().trim().max(2000, 'Description must be at most 2000 characters.'),
  priceDollars: z
    .string()
    .trim()
    .min(1, 'Price is required.')
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid price, e.g. 19.99.'),
  initialOnHand: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d+$/.test(value), 'Enter a whole number.'),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

export default function NewProductPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: { sku: '', name: '', description: '', priceDollars: '', initialOnHand: '' },
  });

  async function onSubmit(values: ProductFormValues) {
    if (!currentOrganizationId) return;
    try {
      const { product } = await api.createProduct(currentOrganizationId, {
        sku: values.sku,
        name: values.name,
        description: values.description || undefined,
        unitPriceCents: Math.round(Number(values.priceDollars) * 100),
        initialOnHand: values.initialOnHand ? Number(values.initialOnHand) : undefined,
      });
      router.push(`/dashboard/products/${product.id}`);
    } catch (err) {
      // 409 is a duplicate SKU (from the API's own uniqueness constraint) — surfaced on the
      // SKU field specifically, since that's the input the user needs to change.
      if (err instanceof ApiError && err.status === 409) {
        setError('sku', { message: err.message });
        return;
      }
      setError('root', {
        message: err instanceof ApiError ? err.message : 'Could not create this product.',
      });
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title="New product" description="Define a product and its starting stock." />
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" autoComplete="off" {...register('sku')} />
              {errors.sku && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.sku.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="off" {...register('name')} />
              {errors.name && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea id="description" rows={3} {...register('description')} />
              {errors.description && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="priceDollars">Price (USD)</Label>
              <Input
                id="priceDollars"
                inputMode="decimal"
                placeholder="19.99"
                {...register('priceDollars')}
              />
              {errors.priceDollars && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.priceDollars.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="initialOnHand">Initial stock (optional)</Label>
              <Input
                id="initialOnHand"
                inputMode="numeric"
                placeholder="0"
                {...register('initialOnHand')}
              />
              {errors.initialOnHand && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.initialOnHand.message}
                </p>
              )}
            </div>

            {errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.message}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="self-start">
              {isSubmitting ? 'Creating…' : 'Create product'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
