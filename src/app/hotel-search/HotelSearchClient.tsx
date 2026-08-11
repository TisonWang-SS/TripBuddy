"use client";

import { useState } from "react";
import { waitForBrowserTask, type BrowserTaskPayload } from "@/lib/browserTaskClient";
import { formatMoney } from "@/lib/format";
import type {
  HotelSearchHotelResult,
  HotelSearchOffer,
  HotelSearchSessionSnapshot
} from "@/lib/hotelSearchSessions";

type SearchResult = {
  availabilityLabel: string;
  avgNightlyRate: number;
  currency: string;
  hotelName: string;
  locationLabel: string | null;
  priceBasis: string;
  sourceUrl: string;
};

type CitySearchPayload = {
  capturedAt: string;
  results: SearchResult[];
  searchSessionId: string;
  searchUrl: string;
  status: "succeeded" | "partial";
  summary: string;
  warning: string | null;
};

type TaxInclusiveTotalPayload = {
  capturedAt: string;
  currency: string;
  fees: number | null;
  hotelName: string;
  nights: number;
  priceBasis: string;
  searchSessionId: string;
  sourceUrl: string;
  subtotal: number | null;
  taxes: number | null;
  taxesAndFees: number | null;
  total: number;
};

type TotalRequestState =
  | { status: "loading" }
  | { error: string; status: "failed" };

const defaultCheckIn = offsetDateInput(14);
const defaultCheckOut = offsetDateInput(15);

export function HotelSearchClient({
  currency,
  hotelGroups
}: {
  currency: string;
  hotelGroups: string[];
}) {
  const [adults, setAdults] = useState("2");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [city, setCity] = useState("");
  const [hotelGroup, setHotelGroup] = useState(hotelGroups[0] ?? "Hyatt");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<HotelSearchSessionSnapshot | null>(null);
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null);
  const [totalRequests, setTotalRequests] = useState<Record<string, TotalRequestState>>({});

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const browserTab = window.open("about:blank", "_blank");
    setError(null);
    setSession(null);
    setSearchSessionId(null);
    setTotalRequests({});
    setLoading(true);
    try {
      if (!browserTab) {
        throw new Error("Chrome blocked the hotel tab. Allow pop-ups for TripBuddy and try again.");
      }
      const response = await fetch("/api/hotel-search", {
        body: JSON.stringify({ adults: Number(adults), checkIn, checkOut, city, hotelGroup }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const task = (await response.json()) as BrowserTaskPayload<CitySearchPayload> & {
        error?: string;
        searchSessionId?: string;
      };
      if (!response.ok) {
        throw new Error(task.error || `Search failed with ${response.status}.`);
      }
      if (!task.searchSessionId) {
        throw new Error("Hotel search session was not created.");
      }
      setSearchSessionId(task.searchSessionId);
      browserTab.location.href = task.launchUrl;
      const taskState = await waitForBrowserTask<CitySearchPayload>(task.taskId, task.expiresAt);
      if (!taskState.result) {
        throw new Error(taskState.errorMessage || "Hotel search returned no result.");
      }
      setSearchSessionId(taskState.result.searchSessionId);
      setSession(await loadSearchSession(taskState.result.searchSessionId));
    } catch (searchError) {
      browserTab?.close();
      setError(searchError instanceof Error ? searchError.message : "Official hotel search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function getTaxInclusiveTotal(hotel: HotelSearchHotelResult) {
    const key = hotel.hotelKey;
    const browserTab = window.open("about:blank", "_blank");
    setTotalRequests((current) => ({ ...current, [key]: { status: "loading" } }));
    try {
      if (!browserTab) {
        throw new Error("Chrome blocked the Hyatt tab. Allow pop-ups for TripBuddy and try again.");
      }
      if (!searchSessionId) {
        throw new Error("Run the city search again before requesting a final total.");
      }
      const response = await fetch("/api/hotel-search", {
        body: JSON.stringify({
          adults: Number(adults),
          checkIn,
          checkOut,
          city,
          hotelGroup,
          hotelName: hotel.hotelName,
          mode: "tax_inclusive_total",
          searchSessionId
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const task = (await response.json()) as BrowserTaskPayload<TaxInclusiveTotalPayload> & { error?: string };
      if (!response.ok) {
        throw new Error(task.error || `Tax-inclusive price check failed with ${response.status}.`);
      }
      browserTab.location.href = task.launchUrl;
      const taskState = await waitForBrowserTask<TaxInclusiveTotalPayload>(task.taskId, task.expiresAt);
      if (!taskState.result) {
        throw new Error(taskState.errorMessage || "Hyatt did not expose a tax-inclusive total.");
      }
      setSession(await loadSearchSession(taskState.result.searchSessionId));
      setTotalRequests((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (totalError) {
      browserTab?.close();
      setTotalRequests((current) => ({
        ...current,
        [key]: { error: totalError instanceof Error ? totalError.message : "Tax-inclusive price check failed.", status: "failed" }
      }));
    }
  }

  return (
    <div className="grid">
      <form className="card form" onSubmit={submitSearch}>
        <div className="grid three">
          <div className="field">
            <label htmlFor="hotelGroup">Hotel group</label>
            <select id="hotelGroup" onChange={(event) => setHotelGroup(event.target.value)} value={hotelGroup}>
              {hotelGroups.map((group) => <option key={group}>{group}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="city">City or destination</label>
            <input id="city" onChange={(event) => setCity(event.target.value)} placeholder="Tokyo" required value={city} />
          </div>
          <div className="field">
            <label htmlFor="adults">Adults</label>
            <input id="adults" min="1" onChange={(event) => setAdults(event.target.value)} required type="number" value={adults} />
          </div>
          <div className="field">
            <label htmlFor="checkIn">Check-in</label>
            <input id="checkIn" onChange={(event) => setCheckIn(event.target.value)} required type="date" value={checkIn} />
          </div>
          <div className="field">
            <label htmlFor="checkOut">Check-out</label>
            <input id="checkOut" onChange={(event) => setCheckOut(event.target.value)} required type="date" value={checkOut} />
          </div>
        </div>
        <p className="muted">Official city prices are captured and displayed in your profile currency: {currency}.</p>
        <button disabled={loading} type="submit">
          {loading ? `Searching ${hotelGroup}...` : `Search official prices in ${currency}`}
        </button>
      </form>

      {error ? <section className="card"><p className="eyebrow">Search failed</p><h2>Official search could not be completed</h2><p>{error}</p></section> : null}
      {session ? (
        <section className="card" data-search-session-id={searchSessionId ?? undefined}>
          <div className="pageHeader">
            <div><p className="eyebrow">{hotelGroup} official results</p><h2>{session.results.hotels.length} hotels found</h2><p>{session.results.summary}</p>{session.results.warning ? <p>{session.results.warning}</p> : null}</div>
            <div className="inlineActions">
              {session.results.hotels[0]?.offers[0]?.sourceUrl ? <a className="button secondary" href={session.results.hotels[0].offers[0].sourceUrl} rel="noreferrer" target="_blank">Open official source</a> : null}
            </div>
          </div>
          {session.results.hotels.length > 0 ? (
            <table className="table"><thead><tr><th>Hotel</th><th>Starting price</th><th>Verified official stay price</th></tr></thead><tbody>
              {session.results.hotels.map((hotel) => {
                const startingOffer = findStartingOffer(hotel.offers);
                const finalOffer = hotel.offers.find((offer) => offer.evidenceLevel === "final_total");
                const totalRequest = totalRequests[hotel.hotelKey];
                return (
                  <tr key={hotel.hotelKey}>
                    <td><strong>{hotel.hotelName}</strong>{hotel.locationLabel ? <p>{hotel.locationLabel}</p> : null}<small className="muted">{hotel.availabilityLabel}</small></td>
                    <td>{startingOffer ? formatMoney(startingOffer.startingAvgNightlyRate ?? startingOffer.displayedAmount, startingOffer.currency) : "Not captured"} <small className="muted">Avg/night; taxes and fees not included</small></td>
                    <td>
                      {finalOffer?.stayTotal !== null && finalOffer?.stayTotal !== undefined ? (
                        <>
                          <strong>Total {formatMoney(finalOffer.stayTotal, finalOffer.currency)}</strong>
                          <p className="muted">Before taxes & fees {finalOffer.staySubtotal === null ? "not captured" : formatMoney(finalOffer.staySubtotal, finalOffer.currency)}</p>
                          <p className="muted">{finalOffer.nights}-night stay · taxes & fees {finalOffer.taxesAndFeesAmount === null ? "included, breakdown not captured" : formatMoney(finalOffer.taxesAndFeesAmount, finalOffer.currency)}</p>
                        </>
                      ) : totalRequest?.status === "loading" ? (
                        <span className="muted">Reading final Hyatt total…</span>
                      ) : (
                        <><button className="secondary" onClick={() => getTaxInclusiveTotal(hotel)} type="button">Get tax-inclusive total</button>{totalRequest?.status === "failed" ? <p className="notice warning">{totalRequest.error}</p> : null}</>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody></table>
          ) : <div className="empty"><h3>No visible official prices</h3><p>Try another date range or inspect the opened source page.</p></div>}
        </section>
      ) : null}
    </div>
  );
}

async function loadSearchSession(searchSessionId: string) {
  const response = await fetch(`/api/hotel-search?sessionId=${encodeURIComponent(searchSessionId)}`, {
    cache: "no-store"
  });
  const session = (await response.json()) as HotelSearchSessionSnapshot & { error?: string };
  if (!response.ok) {
    throw new Error(session.error || "Hotel search session was not found or expired.");
  }
  return session;
}

function findStartingOffer(offers: HotelSearchOffer[]) {
  return offers.find((offer) => offer.startingAvgNightlyRate !== null) ?? offers[0] ?? null;
}

function offsetDateInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
