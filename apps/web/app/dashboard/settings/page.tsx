'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/error-state';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useOrganization } from '@/lib/organization-context';

export default function SettingsPage() {
  const { currentOrganizationId, currentOrganization, refreshOrganizations } = useOrganization();

  if (!currentOrganizationId || !currentOrganization) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <PageHeader title="Organization settings" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title="Organization settings" />
      <OrganizationNameForm
        key={currentOrganizationId}
        organizationId={currentOrganizationId}
        role={currentOrganization.role}
        onRenamed={refreshOrganizations}
      />
    </div>
  );
}

function OrganizationNameForm({
  organizationId,
  role,
  onRenamed,
}: {
  organizationId: string;
  role: 'owner' | 'staff';
  onRenamed: () => void;
}) {
  const [name, setName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getOrganization(organizationId, controller.signal)
      .then(({ organization }) => {
        setName(organization.name);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(err instanceof ApiError ? err.message : 'Could not load this organization.');
      });
    return () => controller.abort();
  }, [organizationId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await api.renameOrganization(organizationId, name);
      setSaveSuccess(true);
      onRenamed();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not rename this organization.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <ErrorState message={loadError} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          {role === 'owner'
            ? "Update your organization's display name."
            : "Only an organization's owner can rename it."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgName">Organization name</Label>
              <Input
                id="orgName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={role !== 'owner' || saving}
              />
            </div>
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
            {saveSuccess && <p className="text-sm text-emerald-600">Saved.</p>}
            {role === 'owner' && (
              <Button type="submit" disabled={saving} className="self-start">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
