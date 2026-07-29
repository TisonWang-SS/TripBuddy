import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { planBrowserAgentAction, type BrowserAgentSnapshot } from "@/lib/browserAgent";

function flushPromises() {
  return new Promise((resolveFlush) => setImmediate(resolveFlush));
}

async function loadContentScript(
  dom: JSDOM,
  options: {
    onClick?: (
      label: string,
      element: Element,
      locationState: { hash: string; hostname: string; href: string; pathname: string },
      recordClick: (element: Element) => void
    ) => void;
    onNavigate?: (
      locationState: { hash: string; hostname: string; href: string; pathname: string },
      recordClick: (element: Element) => void
    ) => void;
    onTimeout?: (callCount: number, recordClick: (element: Element) => void) => void;
    agentResponder?: (snapshot: BrowserAgentSnapshot) => Record<string, unknown>;
  } = {}
) {
  const hooks = options;
  const fetchCalls: Array<{ options: unknown; url: string }> = [];
  const agentCalls: Array<{ options: unknown; url: string }> = [];
  const clickedLabels: string[] = [];
  const navigationTargets: string[] = [];
  let now = 0;
  let timeoutCalls = 0;
  class FakeDate extends Date {
    static now() {
      now += 1000;
      return now;
    }
  }
  const locationState = {
    hash: dom.window.location.hash,
    hostname: dom.window.location.hostname,
    href: dom.window.location.href,
    pathname: dom.window.location.pathname
  };
  const sandbox = {
    URL,
    URLSearchParams,
    chrome: {
      storage: {
        local: {
          get: async () => ({ endpoint: "http://localhost:3000" })
        }
      }
    },
    Date: FakeDate,
    document: dom.window.document,
    fetch: async (url: string, requestOptions: unknown) => {
      if (String(url).includes("/api/browser-agent/snapshot")) {
        agentCalls.push({ options: requestOptions, url });
        const requestBody = JSON.parse(String((requestOptions as { body?: string })?.body || "{}")) as BrowserAgentSnapshot;
        return {
          json: async () =>
            hooks.agentResponder?.(requestBody) ??
            planBrowserAgentAction({ ...requestBody, targetHotelName: "Grand Hyatt Kuala Lumpur" }),
          ok: true
        };
      }
      fetchCalls.push({ options: requestOptions, url });
      return {
        json: async () => ({ candidatesImported: 1 }),
        ok: true
      };
    },
    location: {
      get href() {
        return locationState.href;
      },
      set href(value) {
        locationState.href = String(value);
        try {
          const url = new URL(locationState.href);
          locationState.hash = url.hash;
          locationState.hostname = url.hostname;
          locationState.pathname = url.pathname;
        } catch {
          locationState.hash = "";
          locationState.hostname = "";
        }
        navigationTargets.push(String(value));
        options.onNavigate?.(locationState, recordClick);
      },
      get hash() {
        return locationState.hash;
      },
      get hostname() {
        return locationState.hostname;
      },
      get pathname() {
        return locationState.pathname;
      }
    },
    MouseEvent: dom.window.MouseEvent,
    sessionStorage: dom.window.sessionStorage,
    setTimeout: (callback: () => void) => {
      timeoutCalls += 1;
      options.onTimeout?.(timeoutCalls, recordClick);
      callback();
      return 1;
    },
    window: dom.window
  };
  function recordClick(element: Element) {
    element.scrollIntoView = () => {};
    element.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 40,
        left: 0,
        right: 160,
        top: 0,
        width: 160,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }) as DOMRect;
    (element as HTMLElement).click = () => {
      const label = (element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      clickedLabels.push(label);
      options.onClick?.(label, element, locationState, recordClick);
    };
  }
  sandbox.document.querySelectorAll("a,button,[role='button']").forEach(recordClick);
  Object.defineProperty(sandbox.document.body, "innerText", {
    configurable: true,
    get() {
      return sandbox.document.body.textContent || "";
    }
  });
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(resolve("browser-extension/content.js"), "utf8"), sandbox);
  for (let index = 0; index < 140; index += 1) {
    await flushPromises();
  }
  return { agentCalls, clickedLabels, fetchCalls, navigationTargets };
}

describe("browser extension content script", () => {
  it("captures Hyatt city-search results through the Browser Companion", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>Kuala Lumpur hotels</h1>
          <button aria-label="Currency" role="combobox"><span id="currency-label">United States Dollar</span></button>
          <div role="listbox"><button role="option">Malaysian Ringgit</button></div>
          <section>Grand Hyatt Kuala Lumpur Award Category 3 Rates from: <span id="grand-price">USD 180</span> Avg/Night <a href="/shop/rooms/kuagh">View Rates</a></section>
          <section>Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Rates from: MYR 345 Avg/Night <a href="/shop/rooms/kulzk">View Rates</a></section>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyCitySearchId=search-1&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000&tripbuddyRequestedCurrency=MYR"
      }
    );

    const { clickedLabels, fetchCalls, navigationTargets } = await loadContentScript(dom, {
      onClick(label) {
        if (label === "Malaysian Ringgit") {
          (dom.window.document.querySelector("#currency-label") as HTMLElement).textContent = "Malaysian Ringgit";
          (dom.window.document.querySelector("#grand-price") as HTMLElement).textContent = "MYR 820";
        }
      }
    });

    expect(navigationTargets).toHaveLength(0);
    expect(clickedLabels).toContain("Malaysian Ringgit");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/api/hyatt-city-search");
    expect(JSON.parse(String((fetchCalls[0].options as { body: string }).body))).toMatchObject({
      pageText: expect.stringContaining("MYR 820"),
      requestId: "search-1",
      sourceUrl: expect.stringContaining("/search/hotels/")
    });
  });

  it("opens Hyatt Stay Details links one at a time in the same tab", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>My Stays</h1>
          <nav>Upcoming Past Missing a reservation?</nav>
          <p>Sat, Aug 1 - Sun, Aug 2 Grand Hyatt Kuala Lumpur Confirmation Number: 40023B23492944</p>
          <a href="/res/en-US/detail/stay-one">Stay Details</a>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays&tripbuddyAccountImportId=account-1&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { fetchCalls, navigationTargets } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(0);
    expect(navigationTargets).toEqual(["https://www.hyatt.com/res/en-US/detail/stay-one"]);
    expect(JSON.parse(dom.window.sessionStorage.getItem("tripbuddyHyattAccountImportState") || "{}")).toMatchObject({
      openedUrls: ["https://www.hyatt.com/res/en-US/detail/stay-one"],
      requestId: "account-1"
    });
  });

  it("waits for Hyatt stay cards instead of importing the initial My Stays shell", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>My Stays</h1>
          <nav>Upcoming Past Missing a reservation? Refresh Filter</nav>
          <p id="loading">Loading reservations...</p>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays&tripbuddyAccountImportId=account-delayed&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { fetchCalls, navigationTargets } = await loadContentScript(dom, {
      onTimeout(callCount, recordClick) {
        if (callCount !== 5) {
          return;
        }
        dom.window.document.querySelector("#loading")?.remove();
        const link = dom.window.document.createElement("a");
        link.href = "/res/en-US/detail/delayed-stay";
        link.textContent = "Stay Details";
        dom.window.document.querySelector("main")?.append(link);
        recordClick(link);
      }
    });

    expect(fetchCalls).toHaveLength(0);
    expect(navigationTargets).toEqual(["https://www.hyatt.com/res/en-US/detail/delayed-stay"]);
  });

  it("posts accumulated Hyatt account snapshots after the final stay detail", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>Grand Hyatt Kuala Lumpur Reservation</h1>
          <p>Confirmation: # 40023B23492944 Check-in Sat, Aug 1, 2026 Checkout Sun, Aug 2, 2026 Price Summary Total Awards 1 Free Night</p>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/res/en-US/detail/stay-one"
      }
    );
    dom.window.sessionStorage.setItem("tripbuddyAccountImportId", "account-1");
    dom.window.sessionStorage.setItem(
      "tripbuddyHyattAccountImportState",
      JSON.stringify({
        openedUrls: ["https://www.hyatt.com/res/en-US/detail/stay-one"],
        pendingUrls: ["https://www.hyatt.com/res/en-US/detail/stay-one"],
        requestId: "account-1",
        snapshots: [
          {
            links: [{ href: "https://www.hyatt.com/res/en-US/detail/stay-one", text: "Stay Details" }],
            text: "Upcoming Past Missing a reservation? Sat, Aug 1 - Sun, Aug 2 Grand Hyatt Kuala Lumpur Confirmation Number: 40023B23492944",
            title: "Hyatt - My Stays",
            url: "https://www.hyatt.com/profile/en-US/my-stays"
          }
        ],
        visitedUrls: ["https://www.hyatt.com/profile/en-US/my-stays"]
      })
    );

    const { fetchCalls, navigationTargets } = await loadContentScript(dom);

    expect(navigationTargets).toHaveLength(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/api/account-bookings/hyatt/import");
    const body = JSON.parse(String((fetchCalls[0].options as { body: string }).body));
    expect(body.requestId).toBe("account-1");
    expect(body.snapshots).toHaveLength(2);
    expect(dom.window.sessionStorage.getItem("tripbuddyAccountImportId")).toBeNull();
  });

  it("waits for complete Hyatt reservation details before posting the snapshot", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>Confirmation</h1>
          <p id="reservation">Check-in Checkout Price Summary</p>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/res/en-US/detail/delayed-stay"
      }
    );
    dom.window.sessionStorage.setItem("tripbuddyAccountImportId", "account-delayed-detail");
    dom.window.sessionStorage.setItem(
      "tripbuddyHyattAccountImportState",
      JSON.stringify({
        openedUrls: ["https://www.hyatt.com/res/en-US/detail/delayed-stay"],
        pendingUrls: ["https://www.hyatt.com/res/en-US/detail/delayed-stay"],
        requestId: "account-delayed-detail",
        snapshots: [
          {
            links: [{ href: "https://www.hyatt.com/res/en-US/detail/delayed-stay", text: "Stay Details" }],
            text: "My Stays Upcoming Past Missing a reservation? Hyatt House Kuala Lumpur, Mont Kiara",
            title: "Hyatt - My Stays",
            url: "https://www.hyatt.com/profile/en-US/my-stays"
          }
        ],
        visitedUrls: ["https://www.hyatt.com/profile/en-US/my-stays"]
      })
    );

    const { fetchCalls } = await loadContentScript(dom, {
      onTimeout(callCount) {
        if (callCount === 4) {
          (dom.window.document.querySelector("#reservation") as HTMLElement).textContent =
            "Confirmation: # 40023B23448487 Hyatt House Kuala Lumpur, Mont Kiara Check-in Mon, Jul 27, 2026 Checkout Sat, Aug 1, 2026 Price Summary Total Points 22,500 Points";
        }
      }
    });

    expect(fetchCalls).toHaveLength(1);
    const body = JSON.parse(String((fetchCalls[0].options as { body: string }).body));
    expect(body.snapshots.at(-1)?.text).toContain("22,500 Points");
  });

  it("opens browser-agent links in the same tab even when Hyatt marks them as new-tab links", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <section>
          <h2>Grand Hyatt Kuala Lumpur Award Category 3</h2>
          <p>Rates from: MYR 820 Avg/Night</p>
          <p>${"World of Hyatt rooms rates availability ".repeat(20)}</p>
          <a href="/shop/rooms/kuagh" target="_blank">View Rates</a>
        </section>
      </body>`,
      {
        url: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { clickedLabels, navigationTargets } = await loadContentScript(dom, {
      agentResponder(snapshot) {
        if (!snapshot.sourceUrl?.includes("/search/hotels/")) {
          return { action: "stop", reason: "Navigation verified." };
        }
        const viewRates = snapshot.controls?.find((control) => control.label.includes("View Rates"));
        return {
          action: "click",
          elementId: viewRates?.elementId,
          reason: "Open the matching Hyatt View Rates result."
        };
      }
    });

    expect(clickedLabels).not.toContain("View Rates");
    expect(navigationTargets).toEqual(["https://www.hyatt.com/shop/rooms/kuagh"]);
  });

  it("clicks Hyatt View Rates but does not import evidence from the search page", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <section>
          <h2>Grand Hyatt Kuala Lumpur Award Category 3</h2>
          <p>Rates from: MYR 820 Avg/Night</p>
          <p>${"World of Hyatt rooms rates availability ".repeat(20)}</p>
          <a href="/shop/rooms/kuagh">View Rates</a>
          <a href="/grand-hyatt/en-US/kuagh-grand-hyatt-kuala-lumpur/hotel-info">Hotel Website</a>
        </section>
      </body>`,
      {
        url: "https://www.hyatt.com/search/hotels/en-US/Grand%20Hyatt%20Kuala%20Lumpur%20Kuala%20Lumpur?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { clickedLabels, fetchCalls, navigationTargets } = await loadContentScript(dom);
    expect(clickedLabels).not.toContain("View Rates");
    expect(clickedLabels).not.toContain("Hotel Website");
    expect(fetchCalls).toHaveLength(0);
    expect(navigationTargets[0]).toBe("https://www.hyatt.com/shop/rooms/kuagh");
  });

  it("continues through Hyatt SPA navigation and selects the lowest rate plan", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <section>
          <h2>Grand Hyatt Kuala Lumpur Award Category 3</h2>
          <p>Rates from: MYR 820 Avg/Night</p>
          <p>${"World of Hyatt rooms rates availability ".repeat(20)}</p>
          <a href="/shop/rooms/kuagh">View Rates</a>
        </section>
      </body>`,
      {
        url: "https://www.hyatt.com/search/hotels/en-US/Grand%20Hyatt%20Kuala%20Lumpur%20Kuala%20Lumpur?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { clickedLabels, fetchCalls, navigationTargets } = await loadContentScript(dom, {
      onNavigate(locationState, recordClick) {
        if (!locationState.pathname.includes("/shop/rooms/kuagh")) {
          return;
        }
        dom.window.document.body.innerHTML = `
          <section>
            <h1>Grand Hyatt Kuala Lumpur</h1>
            <p>1 King Bed City view room View Room Details Member Rate MYR 820 Avg/Night</p>
            <button>Select & Book</button>
          </section>`;
        Object.defineProperty(dom.window.document.body, "innerText", {
          configurable: true,
          get() {
            return dom.window.document.body.textContent || "";
          }
        });
        dom.window.document.querySelectorAll("button").forEach(recordClick);
      },
      onClick(label, _element, locationState, recordClick) {
        if (label === "Select & Book") {
          locationState.href =
            "https://www.hyatt.com/shop/rooms/kuagh/rates?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000";
          locationState.pathname = "/shop/rooms/kuagh/rates";
          dom.window.document.body.innerHTML = `
            <main>
              <nav><a href="/hyatt-select/en-US">Hyatt Select</a></nav>
              <h1>Choose Your Rate</h1>
              <section>
                <h2>Standard Rate</h2>
                <p>Standard Rate MYR 900 Cancellation Policy Cancel before arrival Deposit Policy Credit card required</p>
                <button>Sign In & Book MYR 900</button>
              </section>
              <section>
                <h2>Member Rate</h2>
                <p>Member Rate MYR 820 Cancellation Policy Cancel before arrival Deposit Policy Credit card required</p>
                <button>Sign In & Book MYR 820</button>
              </section>
            </main>`;
        } else if (label === "Sign In & Book MYR 820") {
          locationState.href =
            "https://www.hyatt.com/booking?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000";
          locationState.pathname = "/booking";
          dom.window.document.body.innerHTML = `
            <main>
              <h1>Price Summary</h1>
              <p>Total Cash MYR984.00</p>
              <p>Taxes & Fees MYR164.00</p>
              <p>Cancellation Policy Cancel before arrival</p>
            </main>`;
        } else {
          return;
        }
        Object.defineProperty(dom.window.document.body, "innerText", {
          configurable: true,
          get() {
            return dom.window.document.body.textContent || "";
          }
        });
        dom.window.document.querySelectorAll("button").forEach(recordClick);
      }
    });

    expect(clickedLabels).toEqual(expect.arrayContaining(["Select & Book", "Sign In & Book MYR 820"]));
    expect(navigationTargets[0]).toBe("https://www.hyatt.com/shop/rooms/kuagh");
    expect(clickedLabels).not.toContain("Hyatt Select");
    expect(clickedLabels).not.toContain("Sign In & Book MYR 900");
    expect(fetchCalls).toHaveLength(1);
  });

  it("selects room-rate controls whose labels include rate details", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>Grand Hyatt Kuala Lumpur</h1>
          <section>
            <h2>1 King Bed</h2>
            <p>Member Rate MYR 820 Avg/Night</p>
            <button>Select & Book MYR 820</button>
          </section>
          <section>
            <h2>Grand Suite</h2>
            <p>Member Rate MYR 1,800 Avg/Night</p>
            <button>Select & Book MYR 1,800</button>
          </section>
        </main>`,
      {
        url: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { clickedLabels, fetchCalls } = await loadContentScript(dom, {
      onClick(label, _element, locationState, recordClick) {
        if (label !== "Select & Book MYR 820") {
          return;
        }
        locationState.href =
          "https://www.hyatt.com/shop/rooms/kuagh/rates?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000";
        locationState.pathname = "/shop/rooms/kuagh/rates";
        dom.window.document.body.innerHTML = `
          <main>
            <h1>Price Summary</h1>
            <p>Total Cash MYR984.00</p>
            <p>Taxes & Fees MYR164.00</p>
          </main>`;
        Object.defineProperty(dom.window.document.body, "innerText", {
          configurable: true,
          get() {
            return dom.window.document.body.textContent || "";
          }
        });
        dom.window.document.querySelectorAll("button").forEach(recordClick);
      }
    });

    expect(clickedLabels).toContain("Select & Book MYR 820");
    expect(clickedLabels).not.toContain("Select & Book MYR 1,800");
    expect(fetchCalls).toHaveLength(1);
  });

  it("continues from Hyatt cart to the final price summary before importing", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>Choose Your Rate</h1>
          <section>
            <h2>Standard Rate</h2>
            <p>Standard Rate MYR 900 Cancellation Policy Cancel before arrival Deposit Policy Credit card required</p>
            <button>Sign In & Book MYR 900</button>
          </section>
          <section>
            <h2>Member Rate</h2>
            <p>Member Rate MYR 820 Cancellation Policy Cancel before arrival Deposit Policy Credit card required</p>
            <button>Sign In & Book MYR 820</button>
          </section>
        </main>`,
      {
        url: "https://www.hyatt.com/shop/rooms/kuagh/rates?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { clickedLabels, fetchCalls } = await loadContentScript(dom, {
      onClick(label, _element, locationState, recordClick) {
        if (label === "Sign In & Book MYR 820") {
          locationState.href =
            "https://www.hyatt.com/booking/cart?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000";
          locationState.pathname = "/booking/cart";
          dom.window.document.body.innerHTML = `
            <main>
              <h1>My Cart</h1>
              <p>Grand Hyatt Kuala Lumpur 1 King Bed Member Rate</p>
              <p>Room total MYR820.00</p>
              <button>Continue</button>
            </main>`;
        } else if (label === "Continue") {
          locationState.href =
            "https://www.hyatt.com/booking/summary?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000";
          locationState.pathname = "/booking/summary";
          dom.window.document.body.innerHTML = `
            <main>
              <h1>Price Summary</h1>
              <p>Total MYR984.00</p>
              <p>Taxes & Fees MYR164.00</p>
              <p>Cancellation Policy Cancel before arrival</p>
            </main>`;
        } else {
          return;
        }
        Object.defineProperty(dom.window.document.body, "innerText", {
          configurable: true,
          get() {
            return dom.window.document.body.textContent || "";
          }
        });
        dom.window.document.querySelectorAll("button").forEach(recordClick);
      }
    });

    expect(clickedLabels).toEqual(expect.arrayContaining(["Sign In & Book MYR 820", "Continue"]));
    expect(clickedLabels).not.toContain("Sign In & Book MYR 900");
    expect(fetchCalls).toHaveLength(1);
  });

  it("does not import stitched Hyatt evidence until the current page has a final total", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <main>
          <h1>My Cart</h1>
          <p>Grand Hyatt Kuala Lumpur 1 King Bed Member Rate</p>
          <p>Room total MYR820.00</p>
          <button>Continue</button>
        </main>
      </body>`,
      {
        url: "https://www.hyatt.com/booking/cart?checkinDate=2026-08-01&checkoutDate=2026-08-02#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );
    dom.window.sessionStorage.setItem(
      "tripbuddyHyattRoomListText",
      "Grand Hyatt Kuala Lumpur 1 King Bed Member Rate MYR 820 Avg/Night Select & Book"
    );

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(0);
  });

  it("does not import from a Hyatt rates shell before a price summary is reached", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <h1>Grand Hyatt Kuala Lumpur</h1>
        <p>${"World of Hyatt rooms rates availability ".repeat(40)}</p>
      </body>`,
      {
        url: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(0);
  });

  it("shows a specific message for Hyatt empty DOM pages", async () => {
    const dom = new JSDOM(`<!doctype html><body></body>`, {
      url: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
    });

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(0);
    expect(dom.window.document.querySelector("#tripbuddy-auto-import-status")?.textContent).toContain("empty Hyatt page");
  });

  it("recognizes Hyatt KPSDK challenge pages as empty DOM failures", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <script src="/challenge/ips.js?x-kpsdk-im=abc"></script>
      </body>`,
      {
        url: "https://www.hyatt.com/shop/rooms/kuagh#tripbuddyBookingId=booking-1"
      }
    );

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(0);
    expect(dom.window.document.querySelector("#tripbuddy-auto-import-status")?.textContent).toContain("empty Hyatt page");
  });

  it("imports from a Hyatt price summary page with final total and taxes", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <h1>Price Summary</h1>
        <p>Total Cash MYR3,031.23</p>
        <p>Taxes & Fees MYR224.53</p>
        <p>Cancellation Policy Free cancellation before arrival</p>
      </body>`,
      {
        url: "https://www.hyatt.com/booking?checkinDate=2026-07-27&checkoutDate=2026-08-03#tripbuddyBookingId=booking-1&tripbuddyHotelName=Grand+Hyatt+Kuala+Lumpur&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000"
      }
    );

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(String((fetchCalls[0].options as { body: string }).body))).toMatchObject({
      bookingId: "booking-1",
      hotelGroup: "Hyatt"
    });
  });

  it("uses the persisted run nonce to allow a new import at the same Hyatt payment URL", async () => {
    const dom = new JSDOM(
      `<!doctype html><body>
        <h1>Price Summary</h1>
        <p>Total Cash $325.37</p>
        <p>Taxes & Fees $24.10</p>
      </body>`,
      {
        url: "https://www.hyatt.com/en-US/payment/details#tripbuddyBookingId=booking-1&tripbuddyRunNonce=run-2"
      }
    );
    dom.window.sessionStorage.setItem("tripbuddyAutoImportedUrl", "booking-1|run-1");

    const { fetchCalls } = await loadContentScript(dom);

    expect(fetchCalls).toHaveLength(1);
    expect(dom.window.sessionStorage.getItem("tripbuddyAutoImportedUrl")).toBe("booking-1|run-2");
  });
});
