import { notFound } from "next/navigation";
import Link from "next/link";
import { updateObservation } from "@/lib/actions";
import { CANCELLATION_MATCHES, CHANNELS, ROOM_MATCHES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function EditObservationPage({
  params
}: {
  params: Promise<{ id: string; observationId: string }>;
}) {
  const { id, observationId } = await params;
  const observation = await prisma.priceObservation.findUnique({
    where: { id: observationId },
    include: { booking: true }
  });

  if (!observation || observation.bookingId !== id) {
    notFound();
  }

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Edit Observation</p>
          <h1>{observation.booking.hotelName}</h1>
          <p>
            {observation.sourceName} · {formatDateTime(observation.observedAt)}
          </p>
        </div>
        <Link className="button secondary" href={`/bookings/${id}`}>
          Back to booking
        </Link>
      </div>

      <form action={updateObservation} className="card form">
        <input type="hidden" name="bookingId" value={id} />
        <input type="hidden" name="observationId" value={observation.id} />
        <div className="grid two">
          <div className="field">
            <label htmlFor="sourceName">Source name</label>
            <input id="sourceName" name="sourceName" defaultValue={observation.sourceName} required />
          </div>
          <div className="field">
            <label htmlFor="sourceType">Source type</label>
            <select id="sourceType" name="sourceType" defaultValue={observation.sourceType}>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inventoryType">Inventory type</label>
            <input id="inventoryType" value={observation.inventoryType} readOnly />
          </div>
          <div className="field">
            <label htmlFor="price">Observed total price</label>
            <input id="price" name="price" type="number" min="0" step="0.01" defaultValue={observation.price} required />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <input id="currency" name="currency" defaultValue={observation.currency} required />
          </div>
          <div className="field">
            <label htmlFor="roomTypeRaw">Observed room type</label>
            <input id="roomTypeRaw" name="roomTypeRaw" defaultValue={observation.roomTypeRaw} required />
          </div>
          <div className="field">
            <label htmlFor="roomMatch">Room match</label>
            <select id="roomMatch" name="roomMatch" defaultValue={observation.roomMatch}>
              {ROOM_MATCHES.map((match) => (
                <option key={match} value={match}>
                  {match}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cancellationMatch">Cancellation match</label>
            <select id="cancellationMatch" name="cancellationMatch" defaultValue={observation.cancellationMatch}>
              {CANCELLATION_MATCHES.map((match) => (
                <option key={match} value={match}>
                  {match}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">Source URL</label>
            <input id="sourceUrl" name="sourceUrl" type="url" defaultValue={observation.sourceUrl ?? ""} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cancellationPolicyRaw">Cancellation policy</label>
          <textarea id="cancellationPolicyRaw" name="cancellationPolicyRaw" defaultValue={observation.cancellationPolicyRaw} required />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" defaultValue={observation.notes ?? ""} />
        </div>
        <div className="check">
          <input id="taxesIncluded" name="taxesIncluded" type="checkbox" defaultChecked={observation.taxesIncluded} />
          <label htmlFor="taxesIncluded">Taxes are included</label>
        </div>
        <div className="check">
          <input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" defaultChecked={observation.breakfastIncluded} />
          <label htmlFor="breakfastIncluded">Breakfast is included</label>
        </div>
        <div className="check">
          <input id="loyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked={observation.loyaltyEligible} />
          <label htmlFor="loyaltyEligible">Eligible for loyalty credit</label>
        </div>
        <button type="submit">Save observation</button>
      </form>
    </div>
  );
}
