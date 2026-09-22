import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdjustInventoryDialog } from './adjust-inventory-dialog';
import { api, ApiError, type InventoryLine } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { ...actual.api, adjustInventory: vi.fn() },
  };
});

const mockedAdjustInventory = vi.mocked(api.adjustInventory);

const line: InventoryLine = {
  productId: 'prod-1',
  sku: 'SKU-1',
  name: 'Widget',
  onHand: 20,
  reserved: 3,
  available: 17,
};

describe('AdjustInventoryDialog', () => {
  beforeEach(() => {
    mockedAdjustInventory.mockReset();
  });

  it('submits a positive adjustment immediately, without an extra confirmation step', async () => {
    const user = userEvent.setup();
    mockedAdjustInventory.mockResolvedValue({ inventory: line });
    const onAdjusted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <AdjustInventoryDialog
        open={true}
        onOpenChange={onOpenChange}
        organizationId="org-1"
        line={line}
        onAdjusted={onAdjusted}
      />,
    );

    await user.type(screen.getByLabelText('Change in on-hand quantity'), '10');
    await user.type(screen.getByLabelText('Reason'), 'Restock');
    await user.click(screen.getByRole('button', { name: /apply adjustment/i }));

    await waitFor(() => expect(mockedAdjustInventory).toHaveBeenCalledTimes(1));
    expect(mockedAdjustInventory).toHaveBeenCalledWith(
      'org-1',
      { productId: 'prod-1', delta: 10, reason: 'Restock' },
      expect.any(String),
    );
    await waitFor(() => expect(onAdjusted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requires an explicit confirmation step before applying a stock decrease', async () => {
    const user = userEvent.setup();
    mockedAdjustInventory.mockResolvedValue({ inventory: line });

    render(
      <AdjustInventoryDialog
        open={true}
        onOpenChange={() => {}}
        organizationId="org-1"
        line={line}
        onAdjusted={() => {}}
      />,
    );

    await user.type(screen.getByLabelText('Change in on-hand quantity'), '-5');
    await user.type(screen.getByLabelText('Reason'), 'Shrinkage');
    await user.click(screen.getByRole('button', { name: /apply adjustment/i }));

    // The API is not called on the first click for a decrease — a confirmation step interposes.
    expect(mockedAdjustInventory).not.toHaveBeenCalled();
    expect(await screen.findByText(/this cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm decrease/i }));
    await waitFor(() =>
      expect(mockedAdjustInventory).toHaveBeenCalledWith(
        'org-1',
        { productId: 'prod-1', delta: -5, reason: 'Shrinkage' },
        expect.any(String),
      ),
    );
  });

  it('reuses the same idempotency key when retrying after a failed submission', async () => {
    const user = userEvent.setup();
    mockedAdjustInventory.mockRejectedValueOnce(
      new ApiError(0, 'Could not reach the server. Check your connection and try again.'),
    );
    mockedAdjustInventory.mockResolvedValueOnce({ inventory: line });

    render(
      <AdjustInventoryDialog
        open={true}
        onOpenChange={() => {}}
        organizationId="org-1"
        line={line}
        onAdjusted={() => {}}
      />,
    );

    await user.type(screen.getByLabelText('Change in on-hand quantity'), '10');
    await user.type(screen.getByLabelText('Reason'), 'Restock');
    await user.click(screen.getByRole('button', { name: /apply adjustment/i }));

    await screen.findByText(/could not reach the server/i);

    await user.click(screen.getByRole('button', { name: /apply adjustment/i }));
    await waitFor(() => expect(mockedAdjustInventory).toHaveBeenCalledTimes(2));

    const firstKey = mockedAdjustInventory.mock.calls[0][2];
    const secondKey = mockedAdjustInventory.mock.calls[1][2];
    expect(secondKey).toBe(firstKey);
  });

  it('disables the submit control until both a nonzero delta and a reason are provided', async () => {
    const user = userEvent.setup();
    render(
      <AdjustInventoryDialog
        open={true}
        onOpenChange={() => {}}
        organizationId="org-1"
        line={line}
        onAdjusted={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /apply adjustment/i })).toBeDisabled();

    await user.type(screen.getByLabelText('Change in on-hand quantity'), '0');
    await user.type(screen.getByLabelText('Reason'), 'No-op');
    expect(screen.getByRole('button', { name: /apply adjustment/i })).toBeDisabled();
  });
});
