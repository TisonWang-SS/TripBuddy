import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SidebarNav, type NavItem } from "@/app/components/SidebarNav";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripBuddy",
  description: "Local hotel booking optimization workspace"
};

export const viewport: Viewport = {
  initialScale: 1,
  width: "device-width"
};

const navItems: readonly NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/hotel-search", label: "Hotel Search" },
  { href: "/bookings/new", label: "Add Booking" },
  { href: "/profile", label: "Profile" },
  { href: "/promotions", label: "Promotions" },
  { href: "/settings", label: "Settings" }
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets data-theme before hydration, so the server markup
    // is expected to differ on that attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <span className="brandMark">TB</span>
              <span>
                <strong>TripBuddy</strong>
                <small>Hotel Optimizer</small>
              </span>
            </Link>
            <SidebarNav items={navItems} />
            <div className="sidebarFooter">
              <ThemeToggle />
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
