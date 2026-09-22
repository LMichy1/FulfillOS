'use client';

import { Button } from '@/components/ui/button';

/**
 * Keyset (cursor) pagination controls — see docs/architecture/order-lifecycle.md#pagination.
 * There is no page-number input and no total-page count: the API doesn't expose one (a COUNT
 * over a large, concurrently-written table on every list request would be its own performance
 * problem), so this only ever offers "next" (the cursor the API returned) and "previous" (a
 * client-held stack of prior cursors) — both driven by real API responses, never invented.
 */
export function PaginationControls({
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  disabled,
}: {
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  disabled?: boolean;
}) {
  if (!hasPrevious && !hasNext) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious || disabled}>
        Previous
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext || disabled}>
        Next
      </Button>
    </div>
  );
}
