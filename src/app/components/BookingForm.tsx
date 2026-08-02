import { createBooking, updateBooking } from "@/lib/actions";
import { CHANNELS, HOTEL_GROUPS } from "@/lib/constants";
import { formatDateInput, formatDateTimeInput } from "@/lib/format";

type BookingFormValue = {
  baselineAwardLabel: string | null;
  baselineCashTotal: number | null;
  baselinePoints: number | null;
  baselineType: string;
  bookingChannel: string;
  bookingUrl: string | null;
  breakfastIncluded: boolean;
  cancellationDeadline: Date | null;
  checkIn: Date;
  checkOut: Date;
  city: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  id: string;
  isSuite: boolean;
  loyaltyEligible: boolean;
  notes: string | null;
  roomType: string;
};

export function BookingForm({ booking }: { booking?: BookingFormValue }) {
  return (
    <form action={booking ? updateBooking : createBooking} className="card form">
      {booking ? <input type="hidden" name="bookingId" value={booking.id} /> : null}
      <div className="grid two">
        <div className="field"><label htmlFor="hotelGroup">Hotel group</label><select id="hotelGroup" name="hotelGroup" defaultValue={booking?.hotelGroup ?? "Hyatt"} required>{HOTEL_GROUPS.map((group) => <option key={group}>{group}</option>)}</select></div>
        <div className="field"><label htmlFor="hotelName">Hotel name</label><input id="hotelName" name="hotelName" defaultValue={booking?.hotelName ?? ""} placeholder="Grand Hyatt Tokyo" required /></div>
        <div className="field"><label htmlFor="city">City</label><input id="city" name="city" defaultValue={booking?.city ?? ""} placeholder="Tokyo" required /></div>
        <div className="field"><label htmlFor="guests">Guests</label><input id="guests" name="guests" type="number" min="1" defaultValue={booking?.guests ?? 1} required /></div>
        <div className="field"><label htmlFor="checkIn">Check-in</label><input id="checkIn" name="checkIn" type="date" defaultValue={booking ? formatDateInput(booking.checkIn) : ""} required /></div>
        <div className="field"><label htmlFor="checkOut">Check-out</label><input id="checkOut" name="checkOut" type="date" defaultValue={booking ? formatDateInput(booking.checkOut) : ""} required /></div>
        <div className="field"><label htmlFor="roomType">Booked room type</label><input id="roomType" name="roomType" defaultValue={booking?.roomType ?? ""} placeholder="King Room" required /></div>
        <div className="field"><label htmlFor="baselineType">Booking baseline</label><select id="baselineType" name="baselineType" defaultValue={booking?.baselineType ?? "cash"}><option value="cash">Cash</option><option value="points">Points + optional cash</option><option value="certificate">Free-night certificate</option></select></div>
        <div className="field"><label htmlFor="baselineCashTotal">Current cash total or points copay</label><input id="baselineCashTotal" name="baselineCashTotal" type="number" min="0" step="0.01" defaultValue={booking?.baselineCashTotal ?? ""} /></div>
        <div className="field"><label htmlFor="baselinePoints">Current points total</label><input id="baselinePoints" name="baselinePoints" type="number" min="0" step="1" defaultValue={booking?.baselinePoints ?? ""} /></div>
        <div className="field"><label htmlFor="baselineAwardLabel">Certificate label</label><input id="baselineAwardLabel" name="baselineAwardLabel" defaultValue={booking?.baselineAwardLabel ?? ""} placeholder="1 Free Night" /></div>
        <div className="field"><label htmlFor="bookingChannel">Booking channel</label><select id="bookingChannel" name="bookingChannel" defaultValue={booking?.bookingChannel ?? "direct"} required>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></div>
        <div className="field"><label htmlFor="cancellationDeadline">Cancellation deadline</label><input id="cancellationDeadline" name="cancellationDeadline" type="datetime-local" defaultValue={booking ? formatDateTimeInput(booking.cancellationDeadline) : ""} /></div>
        <div className="field"><label htmlFor="bookingUrl">Booking URL</label><input id="bookingUrl" name="bookingUrl" type="url" defaultValue={booking?.bookingUrl ?? ""} placeholder="https://..." /></div>
      </div>
      <div className="check"><input id="isSuite" name="isSuite" type="checkbox" defaultChecked={booking?.isSuite ?? false} /><label htmlFor="isSuite">Booked room is a suite</label></div>
      <div className="check"><input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" defaultChecked={booking?.breakfastIncluded ?? false} /><label htmlFor="breakfastIncluded">Breakfast is included</label></div>
      <div className="check"><input id="loyaltyEligible" name="loyaltyEligible" type="checkbox" defaultChecked={booking?.loyaltyEligible ?? true} /><label htmlFor="loyaltyEligible">Eligible for loyalty credit</label></div>
      <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" defaultValue={booking?.notes ?? ""} /></div>
      <button type="submit">{booking ? "Save booking" : "Create booking"}</button>
    </form>
  );
}
