import { notFound } from "next/navigation";
import Link from "next/link";
import { updateBooking } from "@/lib/actions";
import { CHANNELS, HOTEL_GROUPS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateInput, formatDateTimeInput } from "@/lib/format";

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({ where: { id } });

  if (!booking) {
    notFound();
  }

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Edit booking</p>
          <h1>{booking.hotelName}</h1>
          <p>Manual baseline fields are kept here for corrections and fallback entry.</p>
        </div>
        <Link className="button secondary" href={`/bookings/${booking.id}`}>
          Back
        </Link>
      </div>

      <form action={updateBooking} className="card form">
        <input type="hidden" name="bookingId" value={booking.id} />
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
          <input id="isSuite" name="isSuite" type="checkbox" defaultChecked={booking.isSuite} />
          <label htmlFor="isSuite">Booked room is a suite</label>
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
        <button type="submit">Save booking</button>
      </form>
    </div>
  );
}
