import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-zinc-900">
        Multi-tenant inventory &amp; order management
      </h1>
      <p className="max-w-md text-zinc-600">
        Organizations manage their own products, stock, and orders with strict tenant isolation.
      </p>
      <div className="flex gap-4">
        <Link
          href="/register"
          className="rounded bg-zinc-900 px-5 py-2 text-white hover:bg-zinc-700"
        >
          Create an organization
        </Link>
        <Link
          href="/login"
          className="rounded border border-zinc-300 px-5 py-2 text-zinc-700 hover:bg-zinc-100"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
