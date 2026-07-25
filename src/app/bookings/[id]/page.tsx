import { notFound } from "next/navigation";
import Link from "next/link";
import { createRecommendationAction, promoteObservationToBooking } from "@/lib/actions";
import { buildHyattSearchUrl, type InventoryType } from "@/lib/collectors";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: {
      watchPlan: true,
      observations: { orderBy: { observedAt: "desc" }, take: 6 },
      recommendations: { orderBy: { generatedAt: "desc" }, take: 1 }
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
  const browserImportUrl = createBrowserImportUrl(booking);

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">{booking.hotelGroup}</p>
          <h1>{booking.hotelName}</h1>
          <p>
            {booking.city} · {formatDate(booking.checkIn)} to {formatDate(booking.checkOut)} · {booking.guests} guest
            {booking.guests === 1 ? "" : "s"} · {booking.isSuite ? "Suite" : "Standard room"}
          </p>
        </div>
        <div className="buttonRow">
          {browserImportUrl ? (
            <a className="button" href={browserImportUrl} target="_blank" rel="noreferrer">
              Chrome import
            </a>
          ) : null}
          <form action={createRecommendationAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button className="secondary" type="submit">
              Refresh
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
          <span className="muted">Latest direct</span>
          <strong>{latestDirect ? formatMoney(latestDirect.price, latestDirect.currency) : "None"}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Latest OTA</span>
          <strong>{latestOta ? formatMoney(latestOta.price, latestOta.currency) : "None"}</strong>
        </div>
      </section>

      <nav className="subnav" aria-label="Booking tools">
        <Link href={`/bookings/${booking.id}/edit`}>Edit booking</Link>
        <Link href={`/bookings/${booking.id}/observations/new`}>Manual entry</Link>
        <Link href={`/bookings/${booking.id}/watch-plan`}>Watch plan</Link>
        <Link href={`/bookings/${booking.id}/logs`}>Logs</Link>
      </nav>

      {latestRecommendation ? (
        <section className="card">
          <div className="pageHeader">
            <div>
              <p className="eyebrow">Recommendation</p>
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
          {candidateObservation ? (
            <form action={promoteObservationToBooking} className="section">
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="observationId" value={candidateObservation.id} />
              <button type="submit">Use candidate price</button>
            </form>
          ) : null}
        </section>
      ) : (
        <section className="empty">
          <h2>No recommendation yet</h2>
          <p>Import or add a price observation, then refresh the decision.</p>
        </section>
      )}

      <section className="card">
        <div className="pageHeader">
          <div>
            <p className="eyebrow">Recent prices</p>
            <h2>Observations</h2>
          </div>
          <Link className="button secondary" href={`/bookings/${booking.id}/logs`}>
            View all
          </Link>
        </div>
        {booking.observations.length === 0 ? (
          <div className="empty">
            <h3>No observations</h3>
            <p>Imported and manual prices will appear here.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Observed</th>
                <th>Source</th>
                <th>Price</th>
                <th>Room</th>
                <th>Policy</th>
              </tr>
            </thead>
            <tbody>
              {booking.observations.map((observation) => (
                <tr key={observation.id}>
                  <td>{formatDateTime(observation.observedAt)}</td>
                  <td>
                    {observation.sourceName}
                    <br />
                    <span className="muted">{observation.sourceType}</span>
                  </td>
                  <td>
                    {observation.inventoryType === "award" && observation.pointsPrice
                      ? `${observation.pointsPrice.toLocaleString("en-US")} points`
                      : formatMoney(observation.price, observation.currency)}
                  </td>
                  <td>
                    {formatObservedRoom(observation.roomTypeRaw)}
                    <br />
                    <span className="muted">{observation.isSuite ? "Suite" : "Standard room"}</span>
                  </td>
                  <td>{formatPolicyStatus(observation.cancellationMatch, observation.cancellationPolicyRaw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function createBrowserImportUrl(booking: {
  bookingUrl: string | null;
  checkIn: Date;
  checkOut: Date;
  city: string;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  id: string;
  roomType: string;
  watchPlan: {
    awardEnabled: boolean;
    browserMode: string;
    cashEnabled: boolean;
  } | null;
}) {
  const sourceUrl = booking.hotelGroup === "Hyatt" ? buildHyattImportUrl(booking) : booking.bookingUrl;
  if (!sourceUrl) {
    return null;
  }

  try {
    const url = new URL(sourceUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    hashParams.set("tripbuddyBookingId", booking.id);
    hashParams.set("tripbuddyEndpoint", "http://localhost:3000");
    url.hash = hashParams.toString();
    return url.toString();
  } catch {
    return null;
  }
}

function buildHyattImportUrl(booking: {
  bookingUrl: string | null;
  checkIn: Date;
  checkOut: Date;
  city: string;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  id: string;
  roomType: string;
  watchPlan: {
    awardEnabled: boolean;
    browserMode: string;
    cashEnabled: boolean;
  } | null;
}) {
  const inventoryTypes: InventoryType[] = [
    ...((booking.watchPlan?.cashEnabled ?? true) ? (["cash"] as const) : []),
    ...((booking.watchPlan?.awardEnabled ?? true) ? (["award"] as const) : [])
  ];

  return buildHyattSearchUrl({
    bookingId: booking.id,
    bookingUrl: booking.bookingUrl,
    browserMode: booking.watchPlan?.browserMode === "interactive" ? "interactive" : "chrome_profile",
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    city: booking.city,
    currency: booking.currency,
    guests: booking.guests,
    hotelGroup: booking.hotelGroup,
    hotelName: booking.hotelName,
    inventoryTypes,
    roomType: booking.roomType
  });
}

function formatObservedRoom(value: string) {
  const room = value.trim();
  return room && !/^(?:unknown|room not captured)$/i.test(room) ? room : "Not captured";
}

function formatPolicyStatus(match: string, policy: string) {
  if (!policy || /policy not captured/i.test(policy)) {
    return "Not captured";
  }
  if (match === "same_or_better") {
    return "Same or better";
  }
  if (match === "worse") {
    return "Worse";
  }
  return "Captured";
}
