'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MenuIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SidebarNav } from './sidebar-nav';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export function DashboardHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
        >
          <MenuIcon />
        </Button>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b border-border">
            <SheetTitle>FulfillOS</SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <Link href="/dashboard/overview" className="hidden font-semibold text-foreground lg:block">
        FulfillOS
      </Link>

      <div className="min-w-0 flex-1">
        <OrgSwitcher />
      </div>

      <UserMenu />
    </header>
  );
}
