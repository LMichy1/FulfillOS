import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewProductPage from './page';
import { api, ApiError } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/organization-context', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { ...actual.api, createProduct: vi.fn() },
  };
});

const mockedUseOrganization = vi.mocked(useOrganization);
const mockedCreateProduct = vi.mocked(api.createProduct);

describe('NewProductPage', () => {
  beforeEach(() => {
    push.mockReset();
    mockedCreateProduct.mockReset();
    mockedUseOrganization.mockReturnValue({
      organizations: [{ id: 'org-1', name: 'Org One', role: 'owner' }],
      organizationsError: null,
      currentOrganizationId: 'org-1',
      currentOrganization: { id: 'org-1', name: 'Org One', role: 'owner' },
      switchOrganization: vi.fn(),
      refreshOrganizations: vi.fn(),
    });
  });

  it('shows validation errors and never calls the API for an empty, invalid submission', async () => {
    const user = userEvent.setup();
    render(<NewProductPage />);

    await user.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText('SKU is required.')).toBeInTheDocument();
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(mockedCreateProduct).not.toHaveBeenCalled();
  });

  it('rejects a malformed price before it would reach the API', async () => {
    const user = userEvent.setup();
    render(<NewProductPage />);

    await user.type(screen.getByLabelText('SKU'), 'SKU-1');
    await user.type(screen.getByLabelText('Name'), 'Widget');
    await user.type(screen.getByLabelText('Price (USD)'), 'not-a-price');
    await user.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText(/enter a valid price/i)).toBeInTheDocument();
    expect(mockedCreateProduct).not.toHaveBeenCalled();
  });

  it('submits valid input to the real API and navigates only after it resolves', async () => {
    const user = userEvent.setup();
    mockedCreateProduct.mockResolvedValue({
      product: { id: 'prod-1', sku: 'SKU-1', name: 'Widget' } as never,
    });

    render(<NewProductPage />);
    await user.type(screen.getByLabelText('SKU'), 'SKU-1');
    await user.type(screen.getByLabelText('Name'), 'Widget');
    await user.type(screen.getByLabelText('Price (USD)'), '19.99');
    await user.click(screen.getByRole('button', { name: /create product/i }));

    await waitFor(() => expect(mockedCreateProduct).toHaveBeenCalledTimes(1));
    expect(mockedCreateProduct).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ sku: 'SKU-1', name: 'Widget', unitPriceCents: 1999 }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/products/prod-1'));
  });

  it('surfaces a duplicate SKU (409) as a field-level error on the SKU input, not a generic failure', async () => {
    const user = userEvent.setup();
    mockedCreateProduct.mockRejectedValue(
      new ApiError(409, 'A product with this SKU already exists.'),
    );

    render(<NewProductPage />);
    await user.type(screen.getByLabelText('SKU'), 'DUP-SKU');
    await user.type(screen.getByLabelText('Name'), 'Widget');
    await user.type(screen.getByLabelText('Price (USD)'), '19.99');
    await user.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows a network-failure error without navigating away', async () => {
    const user = userEvent.setup();
    mockedCreateProduct.mockRejectedValue(
      new ApiError(0, 'Could not reach the server. Check your connection and try again.'),
    );

    render(<NewProductPage />);
    await user.type(screen.getByLabelText('SKU'), 'SKU-2');
    await user.type(screen.getByLabelText('Name'), 'Widget');
    await user.type(screen.getByLabelText('Price (USD)'), '19.99');
    await user.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
