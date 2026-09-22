'use client';

import { useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError, type InventoryLine } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

/**
 * A single dialog handles both increases and decreases; a decrease requires an extra explicit
 * confirmation step (a decrease is consequential and, once fulfilled orders or further
 * adjustments build on top of it, effectively irreversible from the UI's perspective — an
 * increase is not). The idempotency key is renewed only when the dialog transitions to open,
 * so retries of the same failed submission (e.g. after a network error) reuse it, but opening
 * the dialog again for a new adjustment always starts a fresh one. See
 * docs/architecture/frontend.md#state-management.
 */
export function AdjustInventoryDialog({
  open,
  onOpenChange,
  organizationId,
  line,
  onAdjusted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  line: InventoryLine;
  onAdjusted: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDecrease, setConfirmingDecrease] = useState(false);

  // Reset during render (not inside a useEffect — see lib/organization-context.tsx for why)
  // whenever `open` transitions to true: a fresh idempotency key and blank fields for this
  // new adjustment attempt. Reopening after a previous attempt (successful or not) always
  // starts over; retries of the *same* failed submission, while the dialog stays open, never
  // hit this branch and so keep the same key.
  const [trackedOpen, setTrackedOpen] = useState(open);
  if (trackedOpen !== open) {
    setTrackedOpen(open);
    if (open) {
      renew();
      setDelta('');
      setReason('');
      setError(null);
      setConfirmingDecrease(false);
    }
  }

  const parsedDelta = Number(delta);
  const isValidDelta = delta.trim() !== '' && Number.isInteger(parsedDelta) && parsedDelta !== 0;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.adjustInventory(
        organizationId,
        { productId: line.productId, delta: parsedDelta, reason },
        key,
      );
      onAdjusted();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply this adjustment.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDelta || !reason.trim()) {
      return;
    }
    if (parsedDelta < 0 && !confirmingDecrease) {
      setConfirmingDecrease(true);
      return;
    }
    void submit();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock — {line.name}</DialogTitle>
          <DialogDescription>
            Currently {line.onHand} on hand, {line.reserved} reserved.
          </DialogDescription>
        </DialogHeader>

        {confirmingDecrease ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              This will reduce on-hand stock by {Math.abs(parsedDelta)} unit
              {Math.abs(parsedDelta) === 1 ? '' : 's'}, to {line.onHand + parsedDelta}. This cannot
              be undone from here. Continue?
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmingDecrease(false)}
                disabled={submitting}
              >
                Back
              </Button>
              <Button variant="destructive" onClick={() => void submit()} disabled={submitting}>
                {submitting ? 'Applying…' : 'Confirm decrease'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delta">Change in on-hand quantity</Label>
              <Input
                id="delta"
                inputMode="numeric"
                placeholder="e.g. 10 or -5"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A positive number restocks; a negative number corrects for shrinkage or loss.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Restock from supplier"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!isValidDelta || !reason.trim() || submitting}>
                {submitting ? 'Applying…' : 'Apply adjustment'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
