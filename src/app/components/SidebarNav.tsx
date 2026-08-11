"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ className, items }: { className?: string; items: readonly NavItem[] }) {
  const pathname = usePathname() ?? "/";

  return (
    <nav className={className}>
      {items.map((item) => (
        <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
