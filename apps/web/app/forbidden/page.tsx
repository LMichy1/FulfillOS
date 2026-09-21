import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">You don&apos;t have access to that</h1>
      <p className="text-sm text-zinc-600">
        Either this organization doesn&apos;t exist, or you&apos;re not a member of it. If you
        believe this is a mistake, contact the organization&apos;s owner.
      </p>
      <Link
        href="/dashboard"
        className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
