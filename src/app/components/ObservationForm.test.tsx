import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObservationForm } from "@/app/components/ObservationForm";

describe("ObservationForm", () => {
  it("supports cash and award facts in the shared manual form", () => {
    render(<ObservationForm booking={{ currency: "USD", id: "booking-1" }} />);

    expect(screen.getByLabelText("Inventory type")).toBeInTheDocument();
    expect(screen.getByLabelText("Final cash total")).toBeInTheDocument();
    expect(screen.getByLabelText("Points total")).toBeInTheDocument();
    expect(screen.getByLabelText("Award cash copay")).toBeInTheDocument();
    expect(screen.getByLabelText("Room assessment")).toHaveValue("auto");
    expect(screen.getByLabelText("Cancellation assessment")).toHaveValue("auto");
  });
});
