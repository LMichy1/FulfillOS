import Link from 'next/link';
import { SidebarNav } from './sidebar-nav';

export function DesktopSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border lg:flex lg:flex-col">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/dashboard/overview" className="font-semibold text-foreground">
          FulfillOS
        </Link>
      </div>
      <SidebarNav />
    </aside>
  );
}
