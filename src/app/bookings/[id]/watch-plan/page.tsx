import { notFound } from "next/navigation";
import Link from "next/link";
import { updateWatchPlan } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { formatLocalInstant } from "@/lib/format";

export default async function WatchPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: { watchPlan: true }
  });

  if (!booking) {
    notFound();
  }

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Watch plan</p>
          <h1>{booking.hotelName}</h1>
          <p>Choose which inventory the next Browser Companion check should collect.</p>
        </div>
        <Link className="button secondary" href={`/bookings/${booking.id}`}>
          Back
        </Link>
      </div>

      <form action={updateWatchPlan} className="card form">
        <input type="hidden" name="bookingId" value={booking.id} />
        <div className="check">
          <input id="cashEnabled" name="cashEnabled" type="checkbox" defaultChecked={booking.watchPlan?.cashEnabled ?? true} />
          <label htmlFor="cashEnabled">Check cash rates</label>
        </div>
        <div className="check">
          <input id="awardEnabled" name="awardEnabled" type="checkbox" defaultChecked={booking.watchPlan?.awardEnabled ?? true} />
          <label htmlFor="awardEnabled">Check award availability</label>
        </div>
        <div className="grid three">
          <div className="field">
            <label htmlFor="normalCadenceHours">Normal reminder cadence (hours)</label>
            <input id="normalCadenceHours" min="1" max="720" name="normalCadenceHours" type="number" defaultValue={booking.watchPlan?.normalCadenceHours ?? 24} />
          </div>
          <div className="field">
            <label htmlFor="urgentCadenceHours">Urgent reminder cadence (hours)</label>
            <input id="urgentCadenceHours" min="1" max="720" name="urgentCadenceHours" type="number" defaultValue={booking.watchPlan?.urgentCadenceHours ?? 6} />
          </div>
          <div className="field">
            <label htmlFor="urgentWindowHours">Urgent window before cancellation (hours)</label>
            <input id="urgentWindowHours" min="1" max="720" name="urgentWindowHours" type="number" defaultValue={booking.watchPlan?.urgentWindowHours ?? 72} />
          </div>
        </div>
        <p className="muted">These values create reminders on the Dashboard. Every check still requires you to click Run price check and keep the visible Hyatt tab open.</p>
        <p>Last checked: {formatLocalInstant(booking.watchPlan?.lastCheckedAt)}</p>
        <p>Last attempted: {formatLocalInstant(booking.watchPlan?.lastAttemptedAt)}</p>
        <p>Consecutive failures: {booking.watchPlan?.consecutiveFailures ?? 0}</p>
        <button type="submit">Save watch plan</button>
      </form>
    </div>
  );
}
