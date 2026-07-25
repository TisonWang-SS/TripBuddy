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
          <p>Secondary controls for automated checks.</p>
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
          <select id="browserMode" name="browserMode" defaultValue={booking.watchPlan?.browserMode ?? "chrome_profile"}>
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
        <button type="submit">Save watch plan</button>
      </form>
    </div>
  );
}
