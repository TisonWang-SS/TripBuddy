"use client";

import { useState } from "react";
import { waitForBrowserTask, type BrowserTaskPayload } from "@/lib/browserTaskClient";
import { Button, Card, Field, FieldGrid, Form, FormActions, Notice } from "@/ui";
import type { HotelSearchHotelResult, HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import { HotelSearchResults, type TotalRequestState } from "./HotelSearchResults";

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

const defaultCheckIn = offsetDateInput(14);
const defaultCheckOut = offsetDateInput(15);

export function HotelSearchClient({
  currency,
  hotelGroups,
  initialSession = null
}: {
  currency: string;
  hotelGroups: string[];
  initialSession?: HotelSearchSessionSnapshot | null;
}) {
  const [adults, setAdults] = useState(String(initialSession?.query.adults ?? 2));
  const [checkIn, setCheckIn] = useState(initialSession?.query.checkIn ?? defaultCheckIn);
  const [checkOut, setCheckOut] = useState(initialSession?.query.checkOut ?? defaultCheckOut);
  const [city, setCity] = useState(initialSession?.query.cityAsAsked ?? "");
  const [hotelGroup, setHotelGroup] = useState(initialSession?.query.hotelGroup ?? hotelGroups[0] ?? "Hyatt");
  const [budgetAmount, setBudgetAmount] = useState(initialSession?.query.budget?.amount.toString() ?? "");
  const [budgetBasis, setBudgetBasis] = useState<"per_night" | "stay_total">(
    initialSession?.query.budget?.basis ?? "stay_total"
  );
  const [budgetFlexibility, setBudgetFlexibility] = useState<"maximum" | "approximate">(
    initialSession?.query.budget?.flexibility ?? "maximum"
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<HotelSearchSessionSnapshot | null>(initialSession);
  const [searchSessionId, setSearchSessionId] = useState<string | null>(initialSession?.id ?? null);
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
        body: JSON.stringify({
          adults: Number(adults),
          budget: budgetAmount
            ? {
                amount: Number(budgetAmount),
                basis: budgetBasis,
                basisAssumed: false,
                flexibility: budgetFlexibility,
                /* Typed into the form, so there is no request wording to cite. */
                quote: null
              }
            : null,
          checkIn,
          checkOut,
          city,
          cityAsAsked: city,
          hotelGroup
        }),
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
          ...session?.query,
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
    <div className="deskStack">
      <Form onSubmit={submitSearch}>
        <FieldGrid>
          <Field htmlFor="hotelGroup" label="Hotel group">
            <select id="hotelGroup" onChange={(event) => setHotelGroup(event.target.value)} value={hotelGroup}>
              {hotelGroups.map((group) => <option key={group}>{group}</option>)}
            </select>
          </Field>
          <Field htmlFor="city" label="City or destination">
            <input id="city" onChange={(event) => setCity(event.target.value)} placeholder="Tokyo" required value={city} />
          </Field>
          <Field htmlFor="adults" label="Adults">
            <input id="adults" min="1" onChange={(event) => setAdults(event.target.value)} required type="number" value={adults} />
          </Field>
          <Field htmlFor="checkIn" label="Check-in">
            <input id="checkIn" onChange={(event) => setCheckIn(event.target.value)} required type="date" value={checkIn} />
          </Field>
          <Field htmlFor="checkOut" label="Check-out">
            <input id="checkOut" onChange={(event) => setCheckOut(event.target.value)} required type="date" value={checkOut} />
          </Field>
          <Field htmlFor="budgetAmount" label={`Tax-inclusive budget amount (${currency})`}>
            <input
              id="budgetAmount"
              min="0.01"
              onChange={(event) => setBudgetAmount(event.target.value)}
              placeholder="Optional"
              step="0.01"
              type="number"
              value={budgetAmount}
            />
          </Field>
          <Field htmlFor="budgetBasis" label="Budget basis">
            <select
              id="budgetBasis"
              onChange={(event) => setBudgetBasis(event.target.value as "per_night" | "stay_total")}
              value={budgetBasis}
            >
              <option value="per_night">Per night</option>
              <option value="stay_total">Whole stay</option>
            </select>
          </Field>
          <Field htmlFor="budgetFlexibility" label="Budget style">
            <select
              id="budgetFlexibility"
              onChange={(event) => setBudgetFlexibility(event.target.value as "maximum" | "approximate")}
              value={budgetFlexibility}
            >
              <option value="maximum">Hard maximum</option>
              <option value="approximate">Around this amount (+10%)</option>
            </select>
          </Field>
        </FieldGrid>

        <Notice>Official city prices are captured and displayed in your profile currency: {currency}.</Notice>

        <FormActions>
          <Button loading={loading} type="submit">
            {loading ? `Searching ${hotelGroup}…` : `Search official prices in ${currency}`}
          </Button>
        </FormActions>
      </Form>

      {error ? (
        <Card eyebrow="Search failed" title="Official search could not be completed">
          <Notice tone="caution">{error}</Notice>
        </Card>
      ) : null}

      {session ? (
        <HotelSearchResults
          onGetTaxInclusiveTotal={getTaxInclusiveTotal}
          session={session}
          totalRequests={totalRequests}
        />
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

function offsetDateInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
