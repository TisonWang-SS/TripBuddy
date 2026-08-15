import Link from "next/link";
import { APPROXIMATE_BUDGET_TOLERANCE, summarizeHotelSearchBudget } from "@/lib/hotelSearchBudget";
import { compareHotelSearchSession } from "@/lib/hotelSearchComparison";
import { formatCalendarDate, formatMoney } from "@/lib/format";
import type { HotelSearchHotelResult, HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import { Button, buttonClassName, Card, EmptyState, Notice, Table } from "@/ui";
import styles from "./HotelSearchClient.module.css";

export type TotalRequestState =
  | { status: "loading" }
  | { error: string; status: "failed" };

export function HotelSearchResults({
  onGetTaxInclusiveTotal,
  session,
  totalRequests = {}
}: {
  onGetTaxInclusiveTotal?: (hotel: HotelSearchHotelResult) => void;
  session: HotelSearchSessionSnapshot;
  totalRequests?: Record<string, TotalRequestState>;
}) {
  const comparison = compareHotelSearchSession(session);
  const budget = summarizeHotelSearchBudget(session.query);
  const pointsMode = session.query.priceMode === "points";
  const hasOtaOffers = session.results.hotels.some((hotel) => hotel.offers.some((offer) => offer.sourceType === "ota"));
  const sourceUrl = comparison.rows.find((row) => row.startingOffer?.sourceUrl)?.startingOffer?.sourceUrl ?? null;
  const mismatches = comparison.rows.filter((row) => row.destinationGrounding === "mismatch");

  return (
    <Card
      actions={sourceUrl ? (
        <a
          className={buttonClassName({ size: "sm", variant: "secondary" })}
          href={sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open official source
        </a>
      ) : null}
      eyebrow={hasOtaOffers ? `${session.query.hotelGroup} official + OTA comparison` : `${session.query.hotelGroup} official results`}
      title={`${session.query.cityAsAsked} · ${comparison.visibleRows.length} ${pointsMode ? "points rates" : "to review"}`}
    >
      <p className={styles.summary}>
        {formatCalendarDate(session.query.checkIn)} to {formatCalendarDate(session.query.checkOut)} · searched as {session.query.city}
      </p>
      {session.results.summary ? <p className={styles.summary}>{session.results.summary}</p> : null}
      {session.results.warning ? <Notice tone="caution">{session.results.warning}</Notice> : null}

      <Notice>
        {pointsMode
          ? "Hyatt award rates are shown as Points/Night. These are redemption estimates for the requested dates; no cash tax-inclusive total is required."
          : budget === null
            ? "Comparison basis: a verified tax-inclusive total or a tax-inclusive OTA quote for the whole stay. Starting Avg/Night prices are discovery hints only."
          : `${budget.flexibility === "approximate" ? "Approximate budget target" : "Budget maximum"}: ${formatMoney(budget.amount, session.query.currency)} ${budget.basis === "per_night" ? "per night" : "for the whole stay"}. ${budget.basisAssumed ? "No basis was stated, so TripBuddy interpreted it as per night. " : ""}${budget.quote ? `Read from your words: “${budget.quote}”. ` : ""}${budget.basis === "per_night" ? `${budget.nights} nights produce a deterministic whole-stay target of ${formatMoney(budget.stayTarget, session.query.currency)}. ` : ""}${budget.flexibility === "approximate" ? `The product-owned ${APPROXIMATE_BUDGET_TOLERANCE * 100}% tolerance sets the comparison ceiling at ${formatMoney(budget.comparisonCeiling, session.query.currency)}. ` : ""}Starting Avg/Night prices never qualify a hotel.`}
      </Notice>
      {!pointsMode && budget !== null && comparison.awaitingFinalTotalCount > 0 ? (
        <Notice tone="caution">
          {comparison.awaitingFinalTotalCount} hotel{comparison.awaitingFinalTotalCount === 1 ? "" : "s"} still need a tax-inclusive total before the budget can decide.
        </Notice>
      ) : null}
      {!pointsMode && comparison.hiddenOverBudgetCount > 0 ? (
        <Notice tone="neutral">
          {comparison.hiddenOverBudgetCount} verified hotel{comparison.hiddenOverBudgetCount === 1 ? " is" : "s are"} above the comparison ceiling and hidden.
        </Notice>
      ) : null}
      {mismatches.length > 0 ? (
        <Notice tone="caution">
          Hyatt labeled {mismatches.map((row) => `${row.hotel.hotelName} as ${row.hotel.locationLabel}`).join(", ")}, which does not match the searched destination {session.query.city}.
        </Notice>
      ) : null}

      {comparison.visibleRows.length > 0 ? (
        <Table className={styles.results}>
          <thead>
            <tr>
              <th scope="col">Hotel</th>
              <th scope="col">{pointsMode ? "Points price" : "Starting price"}</th>
              <th scope="col">{pointsMode ? "Award details" : "Budget comparison"}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.visibleRows.map(({ budgetStatus, finalOffers, hotel, startingOffer }) => {
              const totalRequest = totalRequests[hotel.hotelKey];
              const hasOfficialFinal = finalOffers.some((offer) => offer.sourceType === "direct");
              return (
                <tr key={hotel.hotelKey}>
                  <td>
                    <span className={styles.hotelName}>{hotel.hotelName}</span>
                    {hotel.locationLabel ? <span className={styles.stacked}>Hyatt location: {hotel.locationLabel}</span> : null}
                    <span className={styles.stacked}>{hotel.availabilityLabel}</span>
                  </td>
                  <td className={styles.money}>
                    {pointsMode
                      ? startingOffer
                        ? `${formatPoints(startingOffer.startingPointsPerNight ?? startingOffer.displayedAmount)} points`
                        : "Not captured"
                      : startingOffer
                        ? formatMoney(startingOffer.startingAvgNightlyRate ?? startingOffer.displayedAmount, startingOffer.currency)
                        : "Not captured"}
                    <span className={styles.stacked}>{pointsMode ? "Points/Night; award availability shown by Hyatt" : "Avg/night; taxes and fees excluded; not used for budget"}</span>
                  </td>
                  <td className={styles.money}>
                    {pointsMode ? (
                      <span className={styles.stacked}>Points redemption rate; no tax-inclusive cash total needed.</span>
                    ) : finalOffers.length > 0 ? (
                      <>
                        {finalOffers.map((offer) => (
                          <div key={offer.offerKey}>
                            <span className={styles.total}>{offer.sourceName}: {formatMoney(offer.stayTotal ?? 0, offer.currency)}</span>
                            <span className={styles.stacked}>
                              {offer.sourceType === "ota"
                                ? "OTA quote · taxes included · fee breakdown not provided · confirm before booking"
                                : `Before taxes & fees ${offer.staySubtotal === null ? "not captured" : formatMoney(offer.staySubtotal, offer.currency)}`}
                            </span>
                            {offer.sourceType !== "ota" ? (
                              <span className={styles.stacked}>
                                {offer.nights}-night stay · taxes &amp; fees {offer.taxesAndFeesAmount === null
                                  ? "included, breakdown not captured"
                                  : formatMoney(offer.taxesAndFeesAmount, offer.currency)}
                              </span>
                            ) : null}
                            {offer.roomType ? <span className={styles.stacked}>{offer.roomType}{offer.ratePlanName ? ` · ${offer.ratePlanName}` : ""}</span> : null}
                          </div>
                        ))}
                        {!hasOfficialFinal && onGetTaxInclusiveTotal ? (
                          <Button onClick={() => onGetTaxInclusiveTotal(hotel)} size="sm" type="button" variant="secondary">
                            Verify official Hyatt total
                          </Button>
                        ) : null}
                        {budgetStatus === "within_budget" ? (
                          <span className={styles.stacked}>
                            {budget?.flexibility === "approximate" ? "Within the approximate range" : "Within the comparable budget"}
                          </span>
                        ) : null}
                      </>
                    ) : totalRequest?.status === "loading" ? (
                      <span className={styles.stacked}>Reading final Hyatt total…</span>
                    ) : (
                      <>
                        {onGetTaxInclusiveTotal ? (
                          <Button onClick={() => onGetTaxInclusiveTotal(hotel)} size="sm" type="button" variant="secondary">
                            Get tax-inclusive total
                          </Button>
                        ) : (
                          <Link
                            className={buttonClassName({ size: "sm", variant: "secondary" })}
                            href={`/hotel-search?sessionId=${encodeURIComponent(session.id)}`}
                          >
                            Verify tax-inclusive total
                          </Link>
                        )}
                        {totalRequest?.status === "failed" ? <Notice tone="caution">{totalRequest.error}</Notice> : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          description={session.results.hotels.length === 0
            ? "Hyatt returned no visible result to ground this destination. Try another date range or inspect the opened source page."
            : "Every hotel with a verified tax-inclusive total is over the saved budget."}
          title={session.results.hotels.length === 0 ? "No Hyatt-grounded results" : "No verified total within budget"}
        />
      )}
    </Card>
  );
}

function formatPoints(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
