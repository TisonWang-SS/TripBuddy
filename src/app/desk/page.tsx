import Link from "next/link";
import { RunPriceCheckButton } from "@/app/components/RunPriceCheckButton";
import { currentLocalDayAsCalendarDate } from "@/lib/bookingDates";
import { formatBookingBaseline } from "@/lib/bookingPrice";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate, formatLocalInstant, formatMoney, formatRetryDelay, nightsBetween } from "@/lib/format";
import { evidenceQualityLabel, riskLevelLabel, sourceTypeLabel, verdictLabel } from "@/lib/labels";
import { buildDuePriceCheckQueue } from "@/lib/watchQueue";
import { buttonClassName, EmptyState, LabelStamp } from "@/ui";
import { ImportHyattBookingsButton } from "./ImportHyattBookingsButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/**
 * Check-in is a calendar date stored at UTC midnight, so the stub's day and
 * month have to be read with UTC components or a westward timezone shows the
 * day before.
 */
function stubDate(value: Date) {
  return { day: String(value.getUTCDate()).padStart(2, "0"), month: MONTHS[value.getUTCMonth()] };
}

function subheading(total: number, actionable: number) {
  if (total === 0) {
    return "Nothing to watch yet — import your Hyatt stays, or add one by hand.";
  }
  if (actionable === 0) {
    return "Everything here is inside its cadence and nothing has changed since the last check.";
  }
  if (actionable === 1) {
    return "One needs a decision before its cancellation window shuts.";
  }
  return `${actionable} need a decision before their cancellation windows shut.`;
}

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

  const latest = bookings.map((booking) => booking.recommendations[0]).filter((item) => item !== undefined);
  const actionable = latest.filter((item) => item.verdict !== "keep").length;
  const urgent = latest.filter((item) => item.verdict === "urgent").length;
  const dueQueue = buildDuePriceCheckQueue(
    bookings.map(({ priceCheckRuns, ...booking }) => ({
      ...booking,
      hasActiveRun: priceCheckRuns.length > 0
    })),
    now
  );

  return (
    <div className={styles.desk}>
      <header className={styles.head}>
        <h1>
          {bookings.length === 0 ? (
            <>
              Nothing on the <em>desk</em>
            </>
          ) : (
            <>
              {bookings.length} {bookings.length === 1 ? "stub" : "stubs"} on the <em>desk</em>
            </>
          )}
        </h1>
        <p className={styles.sub}>{subheading(bookings.length, actionable)}</p>
        <div className={styles.meta}>
          <span>
            Active <b>{bookings.length}</b>
          </span>
          <span>
            Actionable <b>{actionable}</b>
          </span>
          <span>
            Urgent <b>{urgent}</b>
          </span>
          <span>
            Checks due <b>{dueQueue.length}</b>
          </span>
        </div>
        <div className={styles.actions}>
          <ImportHyattBookingsButton className={buttonClassName({ variant: "secondary" })} />
          <Link className={buttonClassName()} href="/bookings/new">
            Add a booking
          </Link>
        </div>
      </header>

      <main>
        {bookings.length === 0 ? (
          <EmptyState
            description="Import your Hyatt stays, or add one by hand, to start tracking direct and reference prices."
            title="No bookings yet"
          />
        ) : (
          <ul className={styles.stubs}>
            {bookings.map((booking) => {
              const { day, month } = stubDate(booking.checkIn);
              const nights = nightsBetween(booking.checkIn, booking.checkOut);
              const recommendation = booking.recommendations[0];
              const observation = booking.observations[0];
              return (
                <li className={styles.stub} key={booking.id}>
                  <div className={styles.tear}>
                    <span className={styles.stubNo}>No. {booking.id.slice(-4).toUpperCase()}</span>
                    <span className={styles.stubDate}>
                      {day} {month}
                    </span>
                    <span className={styles.stubNights}>
                      {nights} {nights === 1 ? "night" : "nights"}
                    </span>
                  </div>

                  <div className={styles.stubBody}>
                    <Link className={styles.hotel} href={`/bookings/${booking.id}`}>
                      {booking.hotelName}
                    </Link>
                    <p className={styles.where}>
                      {[
                        booking.hotelGroup,
                        booking.city,
                        `${formatCalendarDate(booking.checkIn)} to ${formatCalendarDate(booking.checkOut)}`,
                        booking.roomType,
                        booking.bookingChannel ? `booked ${sourceTypeLabel(booking.bookingChannel).label.toLowerCase()}` : null
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className={styles.facts}>
                      <span>
                        Evidence <b>{recommendation ? evidenceQualityLabel(recommendation.qualityLevel).label : "None yet"}</b>
                      </span>
                      {recommendation ? (
                        <span>
                          Risk <b>{riskLevelLabel(recommendation.riskLevel).label}</b>
                        </span>
                      ) : null}
                      {booking.cancellationDeadline ? (
                        <span>
                          Cancel by <b>{formatLocalInstant(booking.cancellationDeadline)}</b>
                        </span>
                      ) : null}
                      {observation ? (
                        <span>
                          Checked <b>{formatLocalInstant(observation.observedAt)}</b>
                        </span>
                      ) : null}
                    </div>
                    {recommendation?.explanation ? <p className={styles.why}>{recommendation.explanation}</p> : null}
                  </div>

                  <div className={styles.stubEnd}>
                    <span className={styles.amount}>{formatBookingBaseline(booking)}</span>
                    <span className={styles.basis}>your booking</span>
                    <LabelStamp value={verdictLabel(recommendation?.verdict)} />
                    {recommendation && recommendation.estimatedSavings > 0 ? (
                      <span className={styles.saving}>
                        saves {formatMoney(recommendation.estimatedSavings, booking.currency)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <aside className={styles.column}>
        <div className={`${styles.columnHead} deskHalftone`}>
          <h2>Price checks due</h2>
          <p>Runs only when you press</p>
        </div>
        {dueQueue.length === 0 ? (
          <div className={styles.job}>
            <p>Nothing is due. Cadence is worked out while TripBuddy is open, so this list fills in as you use it.</p>
          </div>
        ) : (
          dueQueue.map((due) => (
            <div className={styles.job} key={due.bookingId}>
              <h3>
                <Link href={`/bookings/${due.bookingId}`}>{due.hotelName}</Link>
              </h3>
              <p className={styles.clock}>Due since {formatLocalInstant(due.nextCheckAt)}</p>
              <p>
                {due.consecutiveFailures > 0
                  ? `${due.consecutiveFailures} failed attempt(s) · retry ${formatRetryDelay(due.retryDelayHours)}`
                  : `${due.urgency === "urgent" ? "Urgent" : "Normal"} cadence · every ${due.cadenceHours} hours`}
              </p>
              <RunPriceCheckButton bookingId={due.bookingId} className={buttonClassName()} trigger="due_queue" />
            </div>
          ))
        )}
        {!profile ? (
          <div className={styles.job}>
            <h3>Profile setup needed</h3>
            <p>Recommendations cannot price loyalty and benefit value until your traveler profile exists.</p>
            <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href="/profile">
              Open profile
            </Link>
          </div>
        ) : null}
      </aside>

      <p className={styles.colophon}>
        <b>TripBuddy never books, cancels, pays for, confirms, or modifies a reservation.</b> The desk stamps a verdict;
        tearing the stub is still something you do on the hotel&rsquo;s own site.
      </p>
    </div>
  );
}
