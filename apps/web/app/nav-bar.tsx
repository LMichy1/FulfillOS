'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '../lib/auth-context';

/**
 * Marketing/auth chrome for the public pages (/, /login, /register). Hidden on /dashboard/*,
 * which has its own header (see components/layout/dashboard-header.tsx) — rendering both would
 * duplicate navigation and the logout control.
 */
export function NavBar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  if (pathname?.startsWith('/dashboard')) {
    return null;
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="border-b border-border bg-background">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3"
      >
        <Link href="/" className="font-semibold text-foreground">
          FulfillOS
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {loading ? null : user ? (
            <>
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                Dashboard
              </Link>
              <span className="text-muted-foreground">{user.displayName}</span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Button size="sm" nativeButton={false} render={<Link href="/register" />}>
                Get started
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
