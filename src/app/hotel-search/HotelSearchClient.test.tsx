import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HotelSearchClient } from "@/app/hotel-search/HotelSearchClient";

describe("HotelSearchClient", () => {
  it("uses one profile currency and lists only supplied providers", () => {
    render(<HotelSearchClient currency="CNY" hotelGroups={["Hyatt"]} />);
    expect(screen.getByLabelText("Hotel group")).toHaveValue("Hyatt");
    expect(screen.queryByText("Marriott")).not.toBeInTheDocument();
    expect(screen.getByText("Official city prices are captured and displayed in your profile currency: CNY.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search official prices in CNY" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
  });
});
