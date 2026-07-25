import { notFound } from "next/navigation";
import Link from "next/link";
import { addObservation } from "@/lib/actions";
import { CANCELLATION_MATCHES, CHANNELS, ROOM_MATCHES } from "@/lib/constants";
import { prisma } from "@/lib/db";

export default async function NewObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({ where: { id } });

  if (!booking) {
    notFound();
  }

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Manual entry</p>
          <h1>{booking.hotelName}</h1>
          <p>Fallback input for prices that cannot be imported automatically yet.</p>
        </div>
        <Link className="button secondary" href={`/bookings/${booking.id}`}>
          Back
        </Link>
      </div>

      <form action={addObservation} className="card form">
        <input type="hidden" name="bookingId" value={booking.id} />
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
          <div className="field">
            <label htmlFor="sourceUrl">Source URL</label>
            <input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cancellationPolicyRaw">Cancellation policy</label>
          <textarea id="cancellationPolicyRaw" name="cancellationPolicyRaw" required />
        </div>
        <div className="check">
          <input id="isSuite" name="isSuite" type="checkbox" />
          <label htmlFor="isSuite">Observed room is a suite</label>
        </div>
        <div className="check">
          <input id="taxesIncluded" name="taxesIncluded" type="checkbox" defaultChecked />
          <label htmlFor="taxesIncluded">Taxes are included</label>
        </div>
        <div className="check">
          <input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" />
          <label htmlFor="breakfastIncluded">Breakfast is included</label>
        </div>
        <div className="check">
          <input id="loyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked />
          <label htmlFor="loyaltyEligible">Eligible for loyalty credit</label>
        </div>
        <button type="submit">Add observation</button>
      </form>
    </div>
  );
}
