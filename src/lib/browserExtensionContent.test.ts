import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const content = readFileSync(resolve("browser-extension/content.js"), "utf8");
const popup = readFileSync(resolve("browser-extension/popup.js"), "utf8");

describe("Browser Companion source", () => {
  it("is valid JavaScript and uses one browser-task API", () => {
    expect(() => new vm.Script(content)).not.toThrow();
    expect(content).toContain("/api/browser-tasks/");
    expect(content).not.toContain("/api/browser-evidence");
    expect(content).not.toContain("/api/browser-agent/snapshot");
  });

  it("keeps explicit final-action guardrails", () => {
    expect(content).toMatch(/payment\|pay now\|confirm\|purchase\|place order\|complete reservation/);
    expect(content).toContain("activateSafeControl(element)");
  });

  it("keeps approved Hyatt links in the same task tab", () => {
    expect(content).toContain("element instanceof HTMLAnchorElement && isHyattNavigationHref(element.href)");
    expect(content).toContain("location.assign(element.href)");
    expect(content).toContain("url.protocol === \"https:\"");
  });

  it("opens collected Stay Details URLs directly", () => {
    expect(content).toContain("findStayDetailLinks");
    expect(content).toContain("await waitForCondition(");
    expect(content).toContain("location.href = state.links[state.index]");
  });

  it("prioritizes visible dialog controls before background room cards", () => {
    expect(content).toContain("const dialogControls = visible.filter");
    expect(content).toContain("const prioritized = [...dialogControls");
  });

  it("returns visible Hyatt sign-in evidence through the task protocol", () => {
    expect(content).toContain("Sign in to Hyatt in Chrome, then start the import again from TripBuddy.");
    expect(content).toContain("snapshots: [buildAccountSnapshot()]");
    expect(content).toContain('searchParams.get("returnUrl")');
  });

  it("requires a visible currency switch before importing city prices", () => {
    expect(content).toContain("selectHyattCurrency(requestedCurrency)");
    expect(content).toContain('task.hotelSearchMode !== "tax_inclusive_total"');
    expect(content).toContain("currencyControlText(toggle)");
    expect(content).toContain("element.innerText || \"\"");
    expect(content).toContain("currency_selector_unavailable");
    expect(content).toContain("no official prices were imported");
  });

  it("allows a tax-total task to continue only when its final visible total matches the requested currency", () => {
    expect(content).toContain("TripBuddy will only accept a final total visibly shown in ${requestedCurrency}.");
  });

  it("keeps popup parsing and arbitrary booking identifiers out of the extension", () => {
    expect(() => new vm.Script(popup)).not.toThrow();
    expect(popup).not.toContain("bookingId");
    expect(popup).not.toContain("parseHyatt");
  });
});
