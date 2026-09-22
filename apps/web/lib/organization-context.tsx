'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type OrganizationSummary } from './api';
import { useAuth } from './auth-context';

/** Purely a UX convenience — which organization to show by default on the next visit. Never
 * treated as authorization: every request still carries the real organization id, and the API
 * independently re-validates membership on every single request via MembershipGuard,
 * regardless of what's stored here. See docs/architecture/frontend.md#organization-switching. */
const LAST_ORG_STORAGE_KEY = 'fulfillos.lastOrganizationId';

interface OrganizationContextValue {
  /** null while loading; empty array for a user with no memberships. */
  organizations: OrganizationSummary[] | null;
  organizationsError: string | null;
  currentOrganizationId: string | null;
  currentOrganization: OrganizationSummary | null;
  switchOrganization: (organizationId: string) => void;
  refreshOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);

  const loadOrganizations = useCallback(async (): Promise<void> => {
    try {
      const { organizations: fetched } = await api.listOrganizations();
      setOrganizations(fetched);
      setOrganizationsError(null);
      setCurrentOrganizationId((previous) => {
        if (previous && fetched.some((org) => org.id === previous)) {
          return previous;
        }
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(LAST_ORG_STORAGE_KEY);
        } catch {
          // localStorage can throw (private browsing, disabled storage) — falling back to
          // the first organization is fine; this is a convenience, never a requirement.
        }
        if (stored && fetched.some((org) => org.id === stored)) {
          return stored;
        }
        return fetched[0]?.id ?? null;
      });
    } catch (error) {
      setOrganizations(null);
      setOrganizationsError(
        error instanceof ApiError ? error.message : 'Could not load your organizations.',
      );
    }
  }, []);

  // Reset during render (not inside the effect below) when `user` changes identity — React
  // itself recommends this pattern for "clear derived state when a prop/value changes" so the
  // reset is visible in the very same render as the change, rather than a synchronous setState
  // call inside a useEffect body (flagged by react-hooks/set-state-in-effect, and for good
  // reason: it would cause an extra, avoidable render pass).
  const [trackedUser, setTrackedUser] = useState(user);
  if (trackedUser !== user) {
    setTrackedUser(user);
    if (!user) {
      setOrganizations(null);
      setOrganizationsError(null);
      setCurrentOrganizationId(null);
    }
  }

  useEffect(() => {
    if (!user) {
      return;
    }
    // loadOrganizations is fully async: every setState inside it happens after an `await`,
    // in a later microtask — never synchronously during this effect's execution, so this
    // isn't the cascading-synchronous-render pattern the rule guards against. The linter's
    // static analysis can't see across that await, so it flags the call anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrganizations();
  }, [user, loadOrganizations]);

  const switchOrganization = useCallback((organizationId: string) => {
    setCurrentOrganizationId(organizationId);
    try {
      window.localStorage.setItem(LAST_ORG_STORAGE_KEY, organizationId);
    } catch {
      // Same as above: losing the "remember last organization" convenience is acceptable.
    }
  }, []);

  const currentOrganization = useMemo(
    () => organizations?.find((org) => org.id === currentOrganizationId) ?? null,
    [organizations, currentOrganizationId],
  );

  return (
    <OrganizationContext.Provider
      value={{
        organizations,
        organizationsError,
        currentOrganizationId,
        currentOrganization,
        switchOrganization,
        refreshOrganizations: loadOrganizations,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider.');
  }
  return context;
}
