'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type OrganizationSummary } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    api
      .listOrganizations()
      .then(({ organizations }) => {
        if (cancelled) return;
        setOrganizations(organizations);
        if (organizations.length > 0) {
          setSelectedId(organizations[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOrganizationsError(
          err instanceof ApiError ? err.message : 'Could not load your organizations.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading || !user) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <p className="text-zinc-600">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-600">Signed in as {user.email}</p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your organizations
        </h2>

        {organizationsError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {organizationsError}
          </p>
        )}

        {organizations === null && !organizationsError && (
          <p className="mt-2 text-sm text-zinc-500">Loading organizations…</p>
        )}

        {organizations !== null && organizations.length === 0 && (
          <p className="mt-2 text-sm text-zinc-500">You don&apos;t belong to any organization.</p>
        )}

        {organizations !== null && organizations.length > 1 && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Switch organization</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.role})
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {/* Keyed by selectedId: switching organizations mounts a fresh instance, which is how
          its detail/rename state resets, rather than manually clearing state inside an
          effect. */}
      {selectedId && <OrganizationDetail key={selectedId} organizationId={selectedId} />}
    </main>
  );
}

function OrganizationDetail({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<{
    id: string;
    name: string;
    role: 'owner' | 'staff';
  } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getOrganization(organizationId)
      .then(({ organization, role }) => {
        if (cancelled) return;
        setDetail({ ...organization, role });
        setRenameValue(organization.name);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          router.push('/forbidden');
          return;
        }
        setDetailError(err instanceof ApiError ? err.message : 'Could not load this organization.');
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, router]);

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setRenameError(null);
    setRenameSuccess(false);
    setRenaming(true);
    try {
      const { organization } = await api.renameOrganization(detail.id, renameValue);
      setDetail({ ...detail, name: organization.name });
      setRenameSuccess(true);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : 'Could not rename this organization.');
    } finally {
      setRenaming(false);
    }
  }

  if (detailError) {
    return (
      <p role="alert" className="mt-6 text-sm text-red-600">
        {detailError}
      </p>
    );
  }

  if (!detail) {
    return <p className="mt-6 text-sm text-zinc-500">Loading organization…</p>;
  }

  return (
    <section className="mt-8 rounded border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-medium text-zinc-900">{detail.name}</h2>
      <p className="mt-1 text-sm text-zinc-500">Your role: {detail.role}</p>

      {detail.role === 'owner' ? (
        <form onSubmit={handleRename} className="mt-4 flex flex-col gap-2" noValidate>
          <label htmlFor="orgName" className="text-sm font-medium text-zinc-700">
            Organization name
          </label>
          <div className="flex gap-2">
            <input
              id="orgName"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="flex-1 rounded border border-zinc-300 px-3 py-2"
            />
            <button
              type="submit"
              disabled={renaming}
              className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {renaming ? 'Saving…' : 'Save'}
            </button>
          </div>
          {renameError && (
            <p role="alert" className="text-sm text-red-600">
              {renameError}
            </p>
          )}
          {renameSuccess && <p className="text-sm text-green-700">Saved.</p>}
        </form>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          Only an organization&apos;s owner can rename it.
        </p>
      )}
    </section>
  );
}
