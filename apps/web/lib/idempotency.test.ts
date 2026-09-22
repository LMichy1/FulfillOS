import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdempotencyKey } from './idempotency';

describe('useIdempotencyKey', () => {
  it('generates a key on mount and keeps the same key across re-renders', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const firstKey = result.current.key;
    expect(firstKey).toBeTruthy();

    rerender();
    expect(result.current.key).toBe(firstKey);
  });

  it('only changes the key when renew() is explicitly called', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const firstKey = result.current.key;

    act(() => {
      result.current.renew();
    });

    expect(result.current.key).not.toBe(firstKey);
  });
});
