import { notFound } from "next/navigation";
import Link from "next/link";
import {
  addObservation,
  createRecommendationAction,
  deleteObservation,
  promoteObservationToBooking,
  runPriceCheck,
  updateBooking,
  updateWatchPlan
} from "@/lib/actions";
import { CANCELLATION_MATCHES, CHANNELS, HOTEL_GROUPS, ROOM_MATCHES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate, formatDateInput, formatDateTime, formatDateTimeInput, formatMoney } from "@/lib/format";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: {
      watchPlan: true,
      priceCheckRuns: { orderBy: { startedAt: "desc" }, take: 5 },
      observations: { orderBy: { observedAt: "desc" } },
      recommendations: { orderBy: { generatedAt: "desc" } }
    }
  });

  if (!booking) {
    notFound();
  }

  const latestRecommendation = booking.recommendations[0];
  const latestDirect = booking.observations.find((item) => item.sourceType === "direct");
  const latestOta = booking.observations.find((item) => item.sourceType === "ota");
  const candidateObservation = latestRecommendation?.candidateObservationId
    ? booking.observations.find((item) => item.id === latestRecommendation.candidateObservationId)
    : null;
  const browserImportUrl = booking.bookingUrl ? createBrowserImportUrl(booking.bookingUrl, booking.id) : null;

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">{booking.hotelGroup}</p>
          <h1>{booking.hotelName}</h1>
          <p>
            {booking.city} · {formatDate(booking.checkIn)} to {formatDate(booking.checkOut)} · {booking.guests} guest
            {booking.guests === 1 ? "" : "s"}
          </p>
        </div>
        <div className="buttonRow">
          <form action={runPriceCheck}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button type="submit">Run price check</button>
          </form>
          <form action={createRecommendationAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button className="secondary" type="submit">
              Refresh recommendation
            </button>
          </form>
        </div>
      </div>

      <section className="grid three">
        <div className="card flat metric">
          <span className="muted">Current baseline</span>
          <strong>{formatMoney(booking.originalPrice, booking.currency)}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Latest direct price</span>
          <strong>{latestDirect ? formatMoney(latestDirect.price, latestDirect.currency) : "None"}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Latest OTA reference</span>
          <strong>{latestOta ? formatMoney(latestOta.price, latestOta.currency) : "None"}</strong>
        </div>
      </section>

      <section className="grid two">
        <form action={updateWatchPlan} className="card form">
          <input type="hidden" name="bookingId" value={booking.id} />
          <p className="eyebrow">Watch Plan</p>
          <h2>Automated checks</h2>
          <div className="divider" />
          <div className="check">
            <input id="cashEnabled" name="cashEnabled" type="checkbox" defaultChecked={booking.watchPlan?.cashEnabled ?? true} />
            <label htmlFor="cashEnabled">Check cash rates</label>
          </div>
          <div className="check">
            <input id="awardEnabled" name="awardEnabled" type="checkbox" defaultChecked={booking.watchPlan?.awardEnabled ?? true} />
            <label htmlFor="awardEnabled">Check award availability</label>
          </div>
          <div className="check">
            <input id="directEnabled" name="directEnabled" type="checkbox" defaultChecked={booking.watchPlan?.directEnabled ?? true} />
            <label htmlFor="directEnabled">Use direct hotel tools first</label>
          </div>
          <div className="check">
            <input
              id="otaReferenceEnabled"
              name="otaReferenceEnabled"
              type="checkbox"
              defaultChecked={booking.watchPlan?.otaReferenceEnabled ?? false}
            />
            <label htmlFor="otaReferenceEnabled">Include OTA reference checks later</label>
          </div>
          <div className="field">
            <label htmlFor="browserMode">Browser mode</label>
            <select id="browserMode" name="browserMode" defaultValue={booking.watchPlan?.browserMode ?? "headless"}>
              <option value="chrome_profile">Chrome profile</option>
              <option value="headless">Server automation</option>
              <option value="interactive">Visible automation window</option>
            </select>
          </div>
          <div className="grid three">
            <div className="field">
              <label htmlFor="normalCadenceHours">Normal cadence hours</label>
              <input
                id="normalCadenceHours"
                name="normalCadenceHours"
                type="number"
                min="1"
                defaultValue={booking.watchPlan?.normalCadenceHours ?? 24}
              />
            </div>
            <div className="field">
              <label htmlFor="urgentCadenceHours">Urgent cadence hours</label>
              <input
                id="urgentCadenceHours"
                name="urgentCadenceHours"
                type="number"
                min="1"
                defaultValue={booking.watchPlan?.urgentCadenceHours ?? 6}
              />
            </div>
            <div className="field">
              <label htmlFor="urgentWindowHours">Urgent window hours</label>
              <input
                id="urgentWindowHours"
                name="urgentWindowHours"
                type="number"
                min="1"
                defaultValue={booking.watchPlan?.urgentWindowHours ?? 72}
              />
            </div>
          </div>
          <p>Last checked: {formatDateTime(booking.watchPlan?.lastCheckedAt)}</p>
          <button className="secondary" type="submit">
            Save watch plan
          </button>
        </form>
        <div className="card">
          <p className="eyebrow">Price Check Runs</p>
          <h2>Recent tool activity</h2>
          <div className="divider" />
          {booking.priceCheckRuns.length === 0 ? (
            <div className="empty">
              <h3>No automated runs yet</h3>
              <p>Run a price check to create the first tool activity record.</p>
            </div>
          ) : (
            <div className="list">
              {booking.priceCheckRuns.map((run) => (
                <div className="listItem" key={run.id}>
                  <div>
                    <h3>{run.collectorName}</h3>
                    <p>{run.summary ?? run.errorMessage ?? "No summary available"}</p>
                    {run.sourceUrl ? (
                      <a className="muted" href={run.sourceUrl} target="_blank" rel="noreferrer">
                        Open source search
                      </a>
                    ) : null}
                  </div>
                  <div>
                    <span className={`badge ${run.status}`}>{run.status}</span>
                    <p>{formatDateTime(run.startedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">Browser Import</p>
        <h2>Import from your real Chrome profile</h2>
        <div className="divider" />
        <div className="grid two">
          <div>
            <p className="muted">Booking ID</p>
            <code>{booking.id}</code>
          </div>
          <div>
            <p className="muted">Local endpoint</p>
            <code>http://localhost:3000</code>
          </div>
        </div>
        <p>
          Load the unpacked extension from <code>browser-extension</code>, open the hotel rate page in your TripBuddy Chrome
          profile, paste this booking ID into the extension, and import the current page.
        </p>
        {browserImportUrl ? (
          <a className="button secondary" href={browserImportUrl} target="_blank" rel="noreferrer">
            Open source and auto import
          </a>
        ) : null}
      </section>

      {latestRecommendation ? (
        <section className="card">
          <div className="pageHeader">
            <div>
              <p className="eyebrow">Current Recommendation</p>
              <h2>
                <span className={`badge ${latestRecommendation.verdict}`}>{latestRecommendation.verdict}</span>
              </h2>
            </div>
            <div>
              <p className="muted">Estimated savings</p>
              <h2>{formatMoney(latestRecommendation.estimatedSavings, booking.currency)}</h2>
            </div>
          </div>
          <p>{latestRecommendation.explanation}</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Cash difference</th>
                <td>{formatMoney(latestRecommendation.cashDifference, booking.currency)}</td>
              </tr>
              <tr>
                <th>Points value difference</th>
                <td>{formatMoney(latestRecommendation.pointsValueDifference, booking.currency)}</td>
              </tr>
              <tr>
                <th>Promotion value difference</th>
                <td>{formatMoney(latestRecommendation.promotionValueDifference, booking.currency)}</td>
              </tr>
              <tr>
                <th>Credit card value difference</th>
                <td>{formatMoney(latestRecommendation.creditCardValueDifference, booking.currency)}</td>
              </tr>
              <tr>
                <th>Elite progress difference</th>
                <td>{formatMoney(latestRecommendation.eliteProgressDifference, booking.currency)}</td>
              </tr>
              <tr>
                <th>Benefit value difference</th>
                <td>{formatMoney(latestRecommendation.benefitValueDifference, booking.currency)}</td>
              </tr>
            </tbody>
          </table>
          <p>
            Recommended workflow: book the better rate first, verify the confirmation, then make that price the new
            baseline here.
          </p>
          {candidateObservation ? (
            <form action={promoteObservationToBooking}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="observationId" value={candidateObservation.id} />
              <button type="submit">Use this price as current booking</button>
            </form>
          ) : null}
        </section>
      ) : (
        <section className="empty">
          <h2>No recommendation yet</h2>
          <p>Add a price observation or refresh the recommendation to get a decision.</p>
        </section>
      )}

      <section className="grid two">
        <form action={updateBooking} className="card form">
          <input type="hidden" name="bookingId" value={booking.id} />
          <p className="eyebrow">Editable Baseline</p>
          <h2>Current booking</h2>
          <div className="grid two">
            <div className="field">
              <label htmlFor="hotelGroup">Hotel group</label>
              <select id="hotelGroup" name="hotelGroup" defaultValue={booking.hotelGroup} required>
                {HOTEL_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hotelName">Hotel name</label>
              <input id="hotelName" name="hotelName" defaultValue={booking.hotelName} required />
            </div>
            <div className="field">
              <label htmlFor="city">City</label>
              <input id="city" name="city" defaultValue={booking.city} required />
            </div>
            <div className="field">
              <label htmlFor="guests">Guests</label>
              <input id="guests" name="guests" type="number" min="1" defaultValue={booking.guests} required />
            </div>
            <div className="field">
              <label htmlFor="checkIn">Check-in</label>
              <input id="checkIn" name="checkIn" type="date" defaultValue={formatDateInput(booking.checkIn)} required />
            </div>
            <div className="field">
              <label htmlFor="checkOut">Check-out</label>
              <input id="checkOut" name="checkOut" type="date" defaultValue={formatDateInput(booking.checkOut)} required />
            </div>
            <div className="field">
              <label htmlFor="roomType">Room type</label>
              <input id="roomType" name="roomType" defaultValue={booking.roomType} required />
            </div>
            <div className="field">
              <label htmlFor="originalPrice">Current total price</label>
              <input
                id="originalPrice"
                name="originalPrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={booking.originalPrice}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input id="currency" name="currency" defaultValue={booking.currency} required />
            </div>
            <div className="field">
              <label htmlFor="bookingChannel">Booking channel</label>
              <select id="bookingChannel" name="bookingChannel" defaultValue={booking.bookingChannel} required>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cancellationDeadline">Cancellation deadline</label>
              <input
                id="cancellationDeadline"
                name="cancellationDeadline"
                type="datetime-local"
                defaultValue={formatDateTimeInput(booking.cancellationDeadline)}
              />
            </div>
            <div className="field">
              <label htmlFor="bookingUrl">Booking URL</label>
              <input id="bookingUrl" name="bookingUrl" type="url" defaultValue={booking.bookingUrl ?? ""} />
            </div>
          </div>
          <div className="check">
            <input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" defaultChecked={booking.breakfastIncluded} />
            <label htmlFor="breakfastIncluded">Breakfast is included</label>
          </div>
          <div className="check">
            <input id="loyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked={booking.loyaltyEligible} />
            <label htmlFor="loyaltyEligible">Eligible for loyalty credit</label>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" defaultValue={booking.notes ?? ""} />
          </div>
          <button type="submit">Save baseline</button>
        </form>

        <form action={addObservation} className="card form">
          <input type="hidden" name="bookingId" value={booking.id} />
          <p className="eyebrow">Manual Observation</p>
          <h2>Add a price check</h2>
          <div className="grid two">
            <div className="field">
              <label htmlFor="sourceName">Source name</label>
              <input id="sourceName" name="sourceName" required placeholder="Hyatt official site" />
            </div>
            <div className="field">
              <label htmlFor="sourceType">Source type</label>
              <select id="sourceType" name="sourceType">
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="price">Observed total price</label>
              <input id="price" name="price" type="number" min="0" step="0.01" required />
            </div>
            <div className="field">
              <label htmlFor="observationCurrency">Currency</label>
              <input id="observationCurrency" name="currency" defaultValue={booking.currency} required />
            </div>
            <div className="field">
              <label htmlFor="roomTypeRaw">Observed room type</label>
              <input id="roomTypeRaw" name="roomTypeRaw" required />
            </div>
            <div className="field">
              <label htmlFor="roomMatch">Room match</label>
              <select id="roomMatch" name="roomMatch">
                {ROOM_MATCHES.map((match) => (
                  <option key={match} value={match}>
                    {match}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cancellationMatch">Cancellation match</label>
              <select id="cancellationMatch" name="cancellationMatch">
                {CANCELLATION_MATCHES.map((match) => (
                  <option key={match} value={match}>
                    {match}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="cancellationPolicyRaw">Cancellation policy</label>
            <textarea id="cancellationPolicyRaw" name="cancellationPolicyRaw" required />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">Source URL</label>
            <input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://..." />
          </div>
          <div className="check">
            <input id="taxesIncluded" name="taxesIncluded" type="checkbox" defaultChecked />
            <label htmlFor="taxesIncluded">Taxes are included</label>
          </div>
          <div className="check">
            <input id="observationBreakfastIncluded" name="breakfastIncluded" type="checkbox" />
            <label htmlFor="observationBreakfastIncluded">Breakfast is included</label>
          </div>
          <div className="check">
            <input id="observationLoyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked />
            <label htmlFor="observationLoyaltyEligible">Eligible for loyalty credit</label>
          </div>
          <button type="submit">Add observation</button>
        </form>
      </section>

      <section className="card">
        <p className="eyebrow">History</p>
        <h2>Price observations</h2>
        <div className="divider" />
        {booking.observations.length === 0 ? (
          <div className="empty">
            <h3>No observations</h3>
            <p>Direct and OTA observations will appear here.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Observed</th>
                <th>Source</th>
                <th>Price</th>
                <th>Match</th>
                <th>Eligibility</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {booking.observations.map((observation) => (
                <tr key={observation.id}>
                  <td>{formatDateTime(observation.observedAt)}</td>
                  <td>
                    {observation.sourceName}
                    <br />
                    <span className="muted">
                      {observation.sourceType} · {observation.collectedBy} · {observation.inventoryType}
                    </span>
                  </td>
                  <td>
                    {observation.inventoryType === "award" && observation.pointsPrice
                      ? `${observation.pointsPrice.toLocaleString("en-US")} points`
                      : formatMoney(observation.price, observation.currency)}
                    {observation.inventoryType === "cash" && observation.basePrice && observation.basePrice !== observation.price ? (
                      <>
                        <br />
                        <span className="muted">{formatMoney(observation.basePrice, observation.currency)} avg/night</span>
                      </>
                    ) : null}
                    {observation.cashCopay ? (
                      <>
                        <br />
                        <span className="muted">+ {formatMoney(observation.cashCopay, observation.currency)}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    Room: {observation.roomMatch}
                    <br />
                    <span className="muted">{observation.roomTypeRaw}</span>
                    <br />
                    Policy: {observation.cancellationMatch}
                    <br />
                    <span className="muted">{observation.cancellationPolicyRaw}</span>
                  </td>
                  <td>
                    {observation.loyaltyEligible ? "Loyalty eligible" : "No loyalty credit"}
                    <br />
                    {observation.taxesIncluded ? "Taxes included" : "Taxes unclear"}
                  </td>
                  <td>
                    <div className="buttonRow">
                      <Link className="button secondary" href={`/bookings/${booking.id}/observations/${observation.id}/edit`}>
                        Edit
                      </Link>
                      <form action={promoteObservationToBooking}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="observationId" value={observation.id} />
                        <button type="submit">Use as current</button>
                      </form>
                      <form action={deleteObservation}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="observationId" value={observation.id} />
                        <button className="danger" type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <p className="eyebrow">Decision History</p>
        <h2>Past recommendations</h2>
        <div className="divider" />
        {booking.recommendations.length === 0 ? (
          <div className="empty">
            <h3>No decision history</h3>
            <p>Recommendations generated for this booking will be stored here.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Verdict</th>
                <th>Savings</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {booking.recommendations.map((recommendation) => (
                <tr key={recommendation.id}>
                  <td>{formatDateTime(recommendation.generatedAt)}</td>
                  <td>
                    <span className={`badge ${recommendation.verdict}`}>{recommendation.verdict}</span>
                  </td>
                  <td>{formatMoney(recommendation.estimatedSavings, booking.currency)}</td>
                  <td>{recommendation.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function createBrowserImportUrl(sourceUrl: string, bookingId: string) {
  try {
    const url = new URL(sourceUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    hashParams.set("tripbuddyBookingId", bookingId);
    hashParams.set("tripbuddyEndpoint", "http://localhost:3000");
    url.hash = hashParams.toString();
    return url.toString();
  } catch {
    return sourceUrl;
  }
}
