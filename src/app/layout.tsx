import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { CommandBar, type Command } from "@/app/components/CommandBar";
import { SidebarNav, type NavItem } from "@/app/components/SidebarNav";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import shell from "./shell.module.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripBuddy",
  description: "Local hotel booking optimization workspace"
};

export const viewport: Viewport = {
  initialScale: 1,
  width: "device-width"
};

/*
 * The conversation is the entry point, so the nav is what you reach for when you
 * want to look at something again rather than ask for it.
 */
const navItems: readonly NavItem[] = [
  { href: "/", label: "Ask" },
  { href: "/desk", label: "Desk" },
  { href: "/bookings/new", label: "Add Booking" },
  { href: "/profile", label: "Profile" },
  { href: "/promotions", label: "Promotions" },
  { href: "/settings", label: "Settings" }
];

const commands: readonly Command[] = [
  { group: "Desk", href: "/", keywords: "chat agent assistant question search", label: "Ask TripBuddy" },
  { group: "Desk", href: "/desk", keywords: "dashboard home watchlist stays bookings queue", label: "Open the desk" },
  { group: "Desk", href: "/bookings/new", keywords: "create new stay reservation", label: "Add a booking" },
  { group: "Set up", href: "/profile", keywords: "loyalty tier points value thresholds", label: "Profile values" },
  { group: "Set up", href: "/promotions", keywords: "bonus offers campaigns", label: "Promotions" },
  { group: "Set up", href: "/settings", keywords: "extractor llm currency preferences", label: "Settings" }
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
        <header className={shell.header}>
          <div className={`${shell.slab} deskHalftone`}>
            <div className={shell.slabInner}>
              <Link className={shell.wordmark} href="/">
                Trip<em>Buddy</em>
              </Link>
              <CommandBar commands={commands} />
              <span className={shell.stamp}>Local only · nothing booked</span>
            </div>
          </div>
          <div className={shell.sections}>
            <SidebarNav className={shell.sectionNav} items={navItems} />
            <div className={shell.sectionsEnd}>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className={shell.page}>{children}</main>
      </body>
    </html>
  );
}
