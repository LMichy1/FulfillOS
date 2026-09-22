import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaginationControls } from './pagination-controls';

describe('PaginationControls', () => {
  it('renders nothing when there is only a single page', () => {
    const { container } = render(
      <PaginationControls
        onPrevious={() => {}}
        onNext={() => {}}
        hasPrevious={false}
        hasNext={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('disables Previous on the first page and enables Next when more pages exist', () => {
    render(
      <PaginationControls
        onPrevious={() => {}}
        onNext={() => {}}
        hasPrevious={false}
        hasNext={true}
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('calls onNext / onPrevious from real API-driven cursor state, not invented page numbers', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <PaginationControls
        onPrevious={onPrevious}
        onNext={onNext}
        hasPrevious={true}
        hasNext={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while a request is in flight', () => {
    render(
      <PaginationControls
        onPrevious={() => {}}
        onNext={() => {}}
        hasPrevious={true}
        hasNext={true}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
