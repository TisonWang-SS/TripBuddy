import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunPriceCheckButton } from "@/app/bookings/[id]/RunPriceCheckButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("RunPriceCheckButton", () => {
  it("renders the single primary booking check action", () => {
    render(<RunPriceCheckButton bookingId="booking-1" />);
    expect(screen.getByRole("button", { name: "Run price check" })).toBeInTheDocument();
  });
});
