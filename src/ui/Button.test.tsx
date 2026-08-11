import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonClassName } from "./Button";

describe("Button", () => {
  it("disables itself and reports busy while loading", () => {
    render(<Button loading>Run price check</Button>);
    const button = screen.getByRole("button", { name: "Run price check" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("is not marked busy when idle", () => {
    render(<Button>Run price check</Button>);
    expect(screen.getByRole("button", { name: "Run price check" })).not.toHaveAttribute("aria-busy");
  });

  it("stays disabled when asked, independently of loading", () => {
    render(<Button disabled>Import bookings</Button>);
    expect(screen.getByRole("button", { name: "Import bookings" })).toBeDisabled();
  });

  it("shares its class list with link-shaped actions", () => {
    render(<Button variant="secondary">Inline</Button>);
    const className = buttonClassName({ variant: "secondary" });
    for (const token of className.split(" ")) {
      expect(screen.getByRole("button", { name: "Inline" }).className).toContain(token);
    }
  });
});
