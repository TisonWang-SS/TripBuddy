"use client";

import { useState } from "react";

type SearchResult = {
  availabilityLabel: string;
  avgNightlyRate: number;
  currency: string;
  hotelName: string;
  locationLabel: string | null;
  priceBasis: string;
  sourceUrl: string;
};

type SearchPayload = {
  capturedAt: string;
  results: SearchResult[];
  searchUrl: string;
  status: "succeeded" | "partial" | "failed";
  summary: string;
  warning: string | null;
};

type BrowserTaskPayload = {
  error?: string | null;
  requestId: string;
  result?: SearchPayload | null;
  searchUrl?: string;
  status: "failed" | "pending" | "succeeded";
};

const defaultCheckIn = offsetDateInput(14);
const defaultCheckOut = offsetDateInput(15);

export function HyattCitySearchClient() {
  const [adults, setAdults] = useState("2");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [city, setCity] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<SearchPayload | null>(null);

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const browserTab = window.open("about:blank", "_blank");
    setError(null);
    setPayload(null);
    setLoading(true);

    try {
      if (!browserTab) {
        throw new Error("Chrome blocked the Hyatt tab. Allow pop-ups for TripBuddy and try again.");
      }
      const params = new URLSearchParams({ adults, checkIn, checkOut, city, currency });
      const response = await fetch(`/api/hyatt-city-search?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as BrowserTaskPayload;
      if (!response.ok) {
        throw new Error(data.error || `Search failed with status ${response.status}.`);
      }
      if (!data.searchUrl) {
        throw new Error("TripBuddy did not return a Hyatt browser URL.");
      }
      browserTab.location.href = data.searchUrl;
      setPayload(await waitForSearchResult(data.requestId));
    } catch (searchError) {
      browserTab?.close();
      setError(searchError instanceof Error ? searchError.message : "Hyatt city search failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid">
      <form className="card form" onSubmit={submitSearch}>
        <div className="grid three">
          <div className="field">
            <label htmlFor="city">City or destination</label>
            <input id="city" name="city" onChange={(event) => setCity(event.target.value)} placeholder="Tokyo" required value={city} />
          </div>
          <div className="field">
            <label htmlFor="checkIn">Check-in</label>
            <input id="checkIn" name="checkIn" onChange={(event) => setCheckIn(event.target.value)} required type="date" value={checkIn} />
          </div>
          <div className="field">
            <label htmlFor="checkOut">Check-out</label>
            <input id="checkOut" name="checkOut" onChange={(event) => setCheckOut(event.target.value)} required type="date" value={checkOut} />
          </div>
        </div>
        <div className="grid three">
          <div className="field">
            <label htmlFor="adults">Adults</label>
            <input id="adults" min="1" name="adults" onChange={(event) => setAdults(event.target.value)} required type="number" value={adults} />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <select id="currency" name="currency" onChange={(event) => setCurrency(event.target.value)} value={currency}>
              {["USD", "CNY", "MYR", "JPY", "SGD", "HKD", "EUR", "GBP"].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="field actionField">
            <label>&nbsp;</label>
            <button disabled={loading} type="submit">
              {loading ? "Searching Hyatt..." : "Search official prices"}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <section className="card">
          <p className="eyebrow">Search failed</p>
          <h2>Hyatt could not be searched</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {payload ? (
        <section className="card">
          <div className="pageHeader">
            <div>
              <p className="eyebrow">Hyatt official results</p>
              <h2>{payload.results.length} hotels found</h2>
              <p>{payload.summary}</p>
              {payload.warning ? <p>{payload.warning}</p> : null}
            </div>
            <a className="button secondary" href={payload.searchUrl} rel="noreferrer" target="_blank">
              Open Hyatt
            </a>
          </div>
          {payload.results.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Hotel</th>
                  <th>Avg/night</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {payload.results.map((result) => (
                  <tr key={`${result.hotelName}-${result.currency}-${result.avgNightlyRate}`}>
                    <td>
                      <strong>{result.hotelName}</strong>
                      {result.locationLabel ? <p>{result.locationLabel}</p> : null}
                      <small className="muted">{result.availabilityLabel}</small>
                    </td>
                    <td>{formatMoney(result.avgNightlyRate, result.currency)}</td>
                    <td>{result.priceBasis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">
              <h3>No visible Hyatt prices</h3>
              <p>Try a different date range or open the Hyatt result directly to confirm whether the site is blocking automated extraction.</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

async function waitForSearchResult(requestId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(`/api/hyatt-city-search?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
    const task = (await response.json()) as BrowserTaskPayload;
    if (!response.ok) {
      throw new Error(task.error || `Search status failed with ${response.status}.`);
    }
    if (task.status === "failed") {
      throw new Error(task.error || "The Hyatt page could not be read by the Browser Companion.");
    }
    if (task.status === "succeeded" && task.result) {
      return task.result;
    }
  }
  throw new Error("Timed out waiting for the Hyatt page. Keep Chrome open and confirm the TripBuddy Browser Companion is enabled.");
}

function offsetDateInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    style: "currency"
  }).format(amount);
}
