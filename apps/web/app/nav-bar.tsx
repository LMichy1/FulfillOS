'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

export function NavBar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3"
      >
        <Link href="/" className="font-semibold text-zinc-900">
          FulfillOS
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {loading ? null : user ? (
            <>
              <Link href="/dashboard" className="text-zinc-600 hover:text-zinc-900">
                Dashboard
              </Link>
              <span className="text-zinc-500">{user.displayName}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-700"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
