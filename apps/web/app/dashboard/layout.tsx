'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { OrganizationProvider, useOrganization } from '@/lib/organization-context';
import { DesktopSidebar } from '@/components/layout/desktop-sidebar';
import { DashboardHeader } from '@/components/layout/dashboard-header';

/**
 * Frontend route protection here is a UX convenience, not the security boundary — the real
 * boundary is every API request's own SessionAuthGuard/MembershipGuard on apps/api (see
 * docs/architecture/frontend.md#authentication-and-csrf-integration). A user who reaches this
 * layout without a valid session gets redirected to /login as soon as the initial /auth/me
 * check (in AuthProvider, mounted in the root layout) resolves; any API call this layout's
 * children make would independently be rejected with 401 regardless.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <OrganizationProvider>
      <DashboardShell>{children}</DashboardShell>
    </OrganizationProvider>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { currentOrganizationId } = useOrganization();

  return (
    <div className="flex min-h-screen w-full">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader />
        {/* Keyed by the current organization: switching organizations remounts every page
            under here, which is what clears previous-tenant form/list state and lets each
            page's own data-fetching effect cancel its in-flight request via cleanup rather
            than risking a late response from the old organization rendering over the new
            one's UI. See docs/architecture/frontend.md#organization-switching. */}
        <main key={currentOrganizationId ?? 'none'} className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
