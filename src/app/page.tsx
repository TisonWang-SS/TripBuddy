import Link from "next/link";
import { RunPriceCheckButton } from "@/app/components/RunPriceCheckButton";
import { currentLocalDayAsCalendarDate } from "@/lib/bookingDates";
import { formatBookingBaseline } from "@/lib/bookingPrice";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate, formatLocalInstant, formatMoney } from "@/lib/format";
import { buildDuePriceCheckQueue } from "@/lib/watchQueue";
import { ImportHyattBookingsButton } from "./ImportHyattBookingsButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const [profile, bookings] = await Promise.all([
    prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } }),
    prisma.hotelBooking.findMany({
      where: { checkIn: { gte: currentLocalDayAsCalendarDate(now) } },
      orderBy: { checkIn: "asc" },
      include: {
        observations: { orderBy: { observedAt: "desc" }, take: 1 },
        priceCheckRuns: {
          where: { expiresAt: { gt: now }, status: "running" },
          select: { id: true },
          take: 1
        },
        recommendations: { where: { candidateObservationId: { not: null } }, orderBy: { generatedAt: "desc" }, take: 1 },
        watchPlan: true
      }
    })
  ]);

  const latestRecommendations = bookings
    .map((booking) => booking.recommendations[0] ? { ...booking.recommendations[0], booking } : null)
    .filter((item) => item !== null)
    .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());

  const actionable = latestRecommendations.filter((item) => item.verdict !== "keep").length;
  const urgent = latestRecommendations.filter((item) => item.verdict === "urgent").length;
  const dueQueue = buildDuePriceCheckQueue(
    bookings.map(({ priceCheckRuns, ...booking }) => ({
      ...booking,
      hasActiveRun: priceCheckRuns.length > 0
    })),
    now
  );

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Hotel watchlist</h1>
          <p>Track active bookings, current decisions, and prices that need action.</p>
        </div>
        <div className="buttonRow">
          <ImportHyattBookingsButton />
          <Link className="button" href="/bookings/new">
            Add a booking
          </Link>
        </div>
      </div>

      <section className="grid three">
        <div className="card flat metric">
          <span className="muted">Active bookings</span>
          <strong>{bookings.length}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Actionable items</span>
          <strong>{actionable}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Urgent windows</span>
          <strong>{urgent}</strong>
        </div>
      </section>

      {dueQueue.length > 0 ? (
        <section className="card">
          <p className="eyebrow">Foreground queue</p>
          <h2>Price checks due</h2>
          <p>These reminders are calculated when TripBuddy is open. Each check starts only after you click the button.</p>
          <div className="divider" />
          <div className="list">
            {dueQueue.map((due) => (
              <div className="listItem" key={due.bookingId}>
                <div>
                  <h3><Link href={`/bookings/${due.bookingId}`}>{due.hotelName}</Link></h3>
                  <p>{due.consecutiveFailures > 0
                    ? `${due.consecutiveFailures} failed attempt(s) · retry after ${due.retryDelayHours} hours`
                    : `${due.urgency === "urgent" ? "Urgent" : "Normal"} cadence · every ${due.cadenceHours} hours`}</p>
                  <small className="muted">Due since {formatLocalInstant(due.nextCheckAt)}</small>
                </div>
                <RunPriceCheckButton bookingId={due.bookingId} trigger="due_queue" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid two">
        <div className="card">
          <div className="pageHeader">
            <div>
              <p className="eyebrow">Bookings</p>
              <h2>Active</h2>
            </div>
          </div>
          {bookings.length === 0 ? (
            <div className="empty">
              <h3>No bookings yet</h3>
              <p>Add a hotel booking to start tracking direct and reference prices.</p>
            </div>
          ) : (
            <div className="list">
              {bookings.map((booking) => {
                const latest = booking.recommendations[0];
                return (
                  <Link className="listItem" href={`/bookings/${booking.id}`} key={booking.id}>
                    <div>
                      <h3>{booking.hotelName}</h3>
                      <p>
                        {booking.hotelGroup} · {booking.city} · {formatCalendarDate(booking.checkIn)} to{" "}
                        {formatCalendarDate(booking.checkOut)}
                      </p>
                    </div>
                    <div>
                      <span className={`badge ${latest?.verdict ?? ""}`}>{latest?.verdict ?? "No verdict"}</span>
                      <p>{formatBookingBaseline(booking)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <p className="eyebrow">Recommendations</p>
          <h2>Latest</h2>
          <div className="divider" />
          {latestRecommendations.length === 0 ? (
            <div className="empty">
              <h3>No recommendations yet</h3>
              <p>Add a price observation from a hotel site or OTA reference to generate a decision.</p>
            </div>
          ) : (
            <div className="list">
              {latestRecommendations.map((recommendation) => (
                <Link className="listItem" href={`/bookings/${recommendation.bookingId}`} key={recommendation.id}>
                  <div>
                    <h3>{recommendation.booking.hotelName}</h3>
                    <p>
                      {formatCalendarDate(recommendation.booking.checkIn)} to {formatCalendarDate(recommendation.booking.checkOut)}
                    </p>
                    <p>{recommendation.explanation}</p>
                    <small className="muted">{formatLocalInstant(recommendation.generatedAt)}</small>
                  </div>
                  <div>
                    <span className={`badge ${recommendation.verdict}`}>{recommendation.verdict}</span>
                    <p>{formatMoney(recommendation.estimatedSavings, recommendation.booking.currency)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {!profile ? (
        <section className="card">
          <h2>Profile setup needed</h2>
          <p>Create your traveler profile before recommendations can include loyalty and benefit value.</p>
          <Link className="button secondary" href="/profile">
            Open profile
          </Link>
        </section>
      ) : null}
    </div>
  );
}
