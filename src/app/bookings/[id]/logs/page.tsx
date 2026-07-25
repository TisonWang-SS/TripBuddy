import { notFound } from "next/navigation";
import Link from "next/link";
import { deleteObservation, promoteObservationToBooking } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

export default async function BookingLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: {
      observations: { orderBy: { observedAt: "desc" } },
      priceCheckRuns: { orderBy: { startedAt: "desc" } },
      recommendations: { orderBy: { generatedAt: "desc" } }
    }
  });

  if (!booking) {
    notFound();
  }

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Logs</p>
          <h1>{booking.hotelName}</h1>
          <p>Detailed import history, manual observations, and recommendation records.</p>
        </div>
        <Link className="button secondary" href={`/bookings/${booking.id}`}>
          Back
        </Link>
      </div>

      <section className="card">
        <div className="pageHeader">
          <div>
            <p className="eyebrow">History</p>
            <h2>Price observations</h2>
          </div>
          <Link className="button secondary" href={`/bookings/${booking.id}/observations/new`}>
            Manual entry
          </Link>
        </div>
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
                    Room: {formatObservedRoom(observation.roomTypeRaw)} · {observation.isSuite ? "Suite" : "Standard room"}
                    <br />
                    <span className="muted">{formatRoomMatchLabel(observation.roomMatch)}</span>
                    <br />
                    Policy: {formatPolicyStatus(observation.cancellationMatch, observation.cancellationPolicyRaw)}
                    <br />
                    <span className="muted">{formatPolicyText(observation.cancellationPolicyRaw)}</span>
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
        <p className="eyebrow">Price Check Runs</p>
        <h2>Tool activity</h2>
        <div className="divider" />
        {booking.priceCheckRuns.length === 0 ? (
          <div className="empty">
            <h3>No automated runs</h3>
            <p>Automated check results will appear here when available.</p>
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

function formatObservedRoom(value: string) {
  const room = value.trim();
  return room && !/^(?:unknown|room not captured)$/i.test(room) ? room : "Not captured";
}

function formatRoomMatchLabel(value: string) {
  if (value === "exact") {
    return "Matches current room";
  }
  if (value === "similar") {
    return "Similar to current room";
  }
  return "Needs review";
}

function formatPolicyStatus(match: string, policy: string) {
  if (!policy || /policy not captured/i.test(policy)) {
    return "Not captured";
  }
  if (match === "same_or_better") {
    return "Same or better";
  }
  if (match === "worse") {
    return "Worse than current";
  }
  return "Captured";
}

function formatPolicyText(value: string) {
  const policy = value
    .replace(/\s+/g, " ")
    .replace(/\s+I accept the deposit and cancellation policy\b.*$/i, "")
    .trim();
  return policy || "Policy not captured";
}
