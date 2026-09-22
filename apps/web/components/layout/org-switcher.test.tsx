import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgSwitcher } from './org-switcher';
import { useOrganization } from '@/lib/organization-context';

vi.mock('@/lib/organization-context', () => ({
  useOrganization: vi.fn(),
}));

const mockedUseOrganization = vi.mocked(useOrganization);

describe('OrgSwitcher', () => {
  beforeEach(() => {
    mockedUseOrganization.mockReset();
  });

  it('renders nothing for a user with no organization memberships', () => {
    mockedUseOrganization.mockReturnValue({
      organizations: [],
      organizationsError: null,
      currentOrganizationId: null,
      currentOrganization: null,
      switchOrganization: vi.fn(),
      refreshOrganizations: vi.fn(),
    });

    const { container } = render(<OrgSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the organization name as plain text, with no switcher control, for a single membership', () => {
    mockedUseOrganization.mockReturnValue({
      organizations: [{ id: 'org-1', name: 'Solo Org', role: 'owner' }],
      organizationsError: null,
      currentOrganizationId: 'org-1',
      currentOrganization: { id: 'org-1', name: 'Solo Org', role: 'owner' },
      switchOrganization: vi.fn(),
      refreshOrganizations: vi.fn(),
    });

    render(<OrgSwitcher />);
    expect(screen.getByText('Solo Org')).toBeInTheDocument();
    expect(screen.queryByLabelText('Switch organization')).not.toBeInTheDocument();
  });

  it('lets a multi-org user switch, calling switchOrganization with the selected id', async () => {
    const user = userEvent.setup();
    const switchOrganization = vi.fn();
    mockedUseOrganization.mockReturnValue({
      organizations: [
        { id: 'org-1', name: 'Org One', role: 'owner' },
        { id: 'org-2', name: 'Org Two', role: 'staff' },
      ],
      organizationsError: null,
      currentOrganizationId: 'org-1',
      currentOrganization: { id: 'org-1', name: 'Org One', role: 'owner' },
      switchOrganization,
      refreshOrganizations: vi.fn(),
    });

    render(<OrgSwitcher />);
    await user.click(screen.getByLabelText('Switch organization'));
    await user.click(await screen.findByRole('option', { name: 'Org Two' }));

    expect(switchOrganization).toHaveBeenCalledWith('org-2');
  });
});
