'use client';

import { Building2Icon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrganization } from '@/lib/organization-context';

/**
 * Switching organizations only ever changes `currentOrganizationId` in
 * `OrganizationProvider` — every page under app/dashboard/layout.tsx is remounted (keyed by
 * that id) when it changes, which is what clears previous-organization form/list state and
 * lets in-flight requests' own AbortController-based effects cancel themselves. See
 * docs/architecture/frontend.md#organization-switching.
 */
export function OrgSwitcher() {
  const { organizations, currentOrganizationId, switchOrganization } = useOrganization();

  if (!organizations || organizations.length === 0) {
    return null;
  }

  if (organizations.length === 1) {
    return (
      <div className="flex items-center gap-2 px-1 text-sm font-medium text-foreground">
        <Building2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {organizations[0].name}
      </div>
    );
  }

  return (
    <Select
      value={currentOrganizationId ?? undefined}
      onValueChange={(value) => {
        if (value) switchOrganization(value);
      }}
    >
      <SelectTrigger aria-label="Switch organization" className="w-full sm:w-56">
        <Building2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <SelectValue placeholder="Select an organization" />
      </SelectTrigger>
      <SelectContent>
        {organizations.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
