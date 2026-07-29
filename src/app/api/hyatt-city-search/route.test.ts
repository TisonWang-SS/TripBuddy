import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/hyatt-city-search/route";
import { resetBrowserTasksForTests } from "@/lib/browserTasks";

describe("Hyatt city search browser task", () => {
  beforeEach(() => resetBrowserTasksForTests());

  it("starts a normal-Chrome task and accepts visible search evidence", async () => {
    const startResponse = await GET(
      new Request(
        "http://localhost:3000/api/hyatt-city-search?city=Kuala%20Lumpur&checkIn=2026-08-01&checkOut=2026-08-02&adults=2&currency=MYR"
      )
    );
    const start = await startResponse.json();

    expect(start.status).toBe("pending");
    expect(start.searchUrl).toContain("tripbuddyCitySearchId=");
    expect(start.searchUrl).toContain("tripbuddyEndpoint=");

    const captureResponse = await POST(
      new Request("http://localhost:3000/api/hyatt-city-search", {
        body: JSON.stringify({
          pageText:
            "Grand Hyatt Kuala Lumpur Award Category 3 Rates from: MYR 820 Avg/Night View Rates Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Rates from: MYR 345 Avg/Night View Rates",
          requestId: start.requestId,
          sourceUrl: start.searchUrl
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    );
    expect(captureResponse.ok).toBe(true);

    const statusResponse = await GET(
      new Request(`http://localhost:3000/api/hyatt-city-search?requestId=${start.requestId}`)
    );
    const status = await statusResponse.json();

    expect(status.status).toBe("succeeded");
    expect(status.result.results).toHaveLength(2);
    expect(status.result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: "MYR",
          hotelName: "Grand Hyatt Kuala Lumpur"
        })
      ])
    );
  });
});
