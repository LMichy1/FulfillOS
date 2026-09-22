import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('does not call onConfirm until the confirm button is clicked', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Cancel this order?"
        description="This cannot be undone."
        onConfirm={onConfirm}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('awaits onConfirm before closing, and only closes after it resolves', async () => {
    const user = userEvent.setup();
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Cancel this order?"
        description="This cannot be undone."
        confirmLabel="Confirm cancellation"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Still open — the backend has not confirmed yet, so success is never claimed early.
    expect(onOpenChange).not.toHaveBeenCalled();

    resolveConfirm();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows an error and stays open when onConfirm rejects', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('Someone else already cancelled this.'));
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Cancel this order?"
        description="This cannot be undone."
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else already cancelled this.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables Cancel while a confirmation is in flight, preventing a second submission', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Cancel this order?"
        description="This cannot be undone."
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  });
});
