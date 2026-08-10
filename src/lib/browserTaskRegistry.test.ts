import { describe, expect, it } from "vitest";
import { browserTaskDefinitions, getBrowserTaskDefinition } from "@/lib/browserTaskRegistry";

describe("browser task registry", () => {
  it("registers every browser task kind behind one definition contract", () => {
    expect(Object.keys(browserTaskDefinitions).sort()).toEqual([
      "account_booking_import",
      "booking_price_check",
      "hotel_search"
    ]);
    for (const kind of Object.keys(browserTaskDefinitions) as Array<keyof typeof browserTaskDefinitions>) {
      expect(getBrowserTaskDefinition(kind)).toMatchObject({
        capture: expect.any(Function),
        create: expect.any(Function),
        kind
      });
    }
  });
});
