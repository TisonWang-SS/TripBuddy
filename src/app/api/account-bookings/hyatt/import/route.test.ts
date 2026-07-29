import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/account-bookings/hyatt/import/route";
import { resetBrowserTasksForTests } from "@/lib/browserTasks";

describe("Hyatt account import browser task", () => {
  beforeEach(() => resetBrowserTasksForTests());

  it("opens My Stays in normal Chrome and exposes pending task status", async () => {
    const startResponse = await POST(
      new Request("http://localhost:3000/api/account-bookings/hyatt/import", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    );
    const start = await startResponse.json();

    expect(start.status).toBe("pending");
    expect(start.launchUrl).toContain("/profile/en-US/my-stays");
    expect(start.launchUrl).toContain("tripbuddyAccountImportId=");

    const statusResponse = await GET(
      new Request(`http://localhost:3000/api/account-bookings/hyatt/import?requestId=${start.requestId}`)
    );
    expect(await statusResponse.json()).toMatchObject({
      requestId: start.requestId,
      status: "pending"
    });
  });
});
