import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./SidebarNav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname }));

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/hotel-search", label: "Hotel Search" },
  { href: "/bookings/new", label: "Add Booking" }
];

function renderAt(pathname: string) {
  usePathname.mockReturnValue(pathname);
  render(<SidebarNav items={items} />);
}

describe("SidebarNav", () => {
  it("marks the matching route as the current page", () => {
    renderAt("/hotel-search");
    expect(screen.getByRole("link", { name: "Hotel Search" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  /*
   * Every route starts with "/", so a prefix match would leave Dashboard
   * permanently active. It is the one item that has to match exactly.
   */
  it("only marks Dashboard current at the root", () => {
    renderAt("/promotions");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");

    renderAt("/");
    expect(screen.getAllByRole("link", { name: "Dashboard" })[1]).toHaveAttribute("aria-current", "page");
  });

  it("keeps the section current on nested routes", () => {
    renderAt("/bookings/new/extra");
    expect(screen.getByRole("link", { name: "Add Booking" })).toHaveAttribute("aria-current", "page");
  });

  it("does not treat a sibling route with a shared prefix as current", () => {
    renderAt("/bookings/new-thing");
    expect(screen.getByRole("link", { name: "Add Booking" })).not.toHaveAttribute("aria-current");
  });
});
