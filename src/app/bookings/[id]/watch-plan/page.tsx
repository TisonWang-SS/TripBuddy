import { notFound } from "next/navigation";
import Link from "next/link";
import { updateWatchPlan } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

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
        <p className="muted">Scheduled execution and OTA collection are not enabled in v0.2. Future schedulers will call the same price-check runner.</p>
        <p>Last checked: {formatDateTime(booking.watchPlan?.lastCheckedAt)}</p>
        <button type="submit">Save watch plan</button>
      </form>
    </div>
  );
}
