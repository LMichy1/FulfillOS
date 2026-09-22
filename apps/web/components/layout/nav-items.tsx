import {
  LayoutDashboardIcon,
  PackageIcon,
  BoxesIcon,
  ShoppingCartIcon,
  SettingsIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard/overview', label: 'Overview', icon: LayoutDashboardIcon },
  { href: '/dashboard/products', label: 'Products', icon: PackageIcon },
  { href: '/dashboard/inventory', label: 'Inventory', icon: BoxesIcon },
  { href: '/dashboard/orders', label: 'Orders', icon: ShoppingCartIcon },
  { href: '/dashboard/settings', label: 'Settings', icon: SettingsIcon },
];
