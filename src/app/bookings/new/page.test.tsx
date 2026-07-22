import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NewBookingPage from "@/app/bookings/new/page";

describe("new booking page", () => {
  it("renders required booking fields", () => {
    render(<NewBookingPage />);
    expect(screen.getByLabelText("Hotel group")).toBeInTheDocument();
    expect(screen.getByLabelText("Hotel name")).toBeInTheDocument();
    expect(screen.getByLabelText("Original total price")).toBeInTheDocument();
    expect(screen.getByText("Save booking")).toBeInTheDocument();
  });
});
