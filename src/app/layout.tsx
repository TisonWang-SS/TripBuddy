import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripBuddy",
  description: "Local hotel booking optimization workspace"
};

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/hotel-search", label: "Hotel Search" },
  { href: "/bookings/new", label: "Add Booking" },
  { href: "/profile", label: "Profile" },
  { href: "/promotions", label: "Promotions" },
  { href: "/settings", label: "Settings" }
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
            <nav className="nav">
              {navItems.map((item) => (
                <Link href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
