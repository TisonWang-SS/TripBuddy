import { createBooking } from "@/lib/actions";
import { CHANNELS, HOTEL_GROUPS } from "@/lib/constants";

export default function NewBookingPage() {
  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Add Booking</p>
          <h1>Start tracking a hotel stay.</h1>
          <p>Enter the current booking details. You can add direct and OTA price observations after saving.</p>
        </div>
      </div>

      <form action={createBooking} className="card form">
        <div className="grid two">
          <div className="field">
            <label htmlFor="hotelGroup">Hotel group</label>
            <select id="hotelGroup" name="hotelGroup" required>
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hotelName">Hotel name</label>
            <input id="hotelName" name="hotelName" required placeholder="Grand Hyatt Tokyo" />
          </div>
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" required placeholder="Tokyo" />
          </div>
          <div className="field">
            <label htmlFor="guests">Guests</label>
            <input id="guests" name="guests" type="number" min="1" defaultValue="1" required />
          </div>
          <div className="field">
            <label htmlFor="checkIn">Check-in</label>
            <input id="checkIn" name="checkIn" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="checkOut">Check-out</label>
            <input id="checkOut" name="checkOut" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="roomType">Booked room type</label>
            <input id="roomType" name="roomType" required placeholder="King Room" />
          </div>
          <div className="field">
            <label htmlFor="originalPrice">Original total price</label>
            <input id="originalPrice" name="originalPrice" type="number" min="0" step="0.01" required />
          </div>
          <div className="field">
            <label htmlFor="bookingChannel">Booking channel</label>
            <select id="bookingChannel" name="bookingChannel" required>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cancellationDeadline">Cancellation deadline</label>
            <input id="cancellationDeadline" name="cancellationDeadline" type="datetime-local" />
          </div>
          <div className="field">
            <label htmlFor="bookingUrl">Booking URL</label>
            <input id="bookingUrl" name="bookingUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="check">
          <input id="isSuite" name="isSuite" type="checkbox" />
          <label htmlFor="isSuite">Booked room is a suite</label>
        </div>
        <div className="check">
          <input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" />
          <label htmlFor="breakfastIncluded">Breakfast is included in the current booking</label>
        </div>
        <div className="check">
          <input id="loyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked />
          <label htmlFor="loyaltyEligible">Current booking earns loyalty credit</label>
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" placeholder="Add rate rules, package details, or confirmation notes." />
        </div>
        <button type="submit">Save booking</button>
      </form>
    </div>
  );
}
