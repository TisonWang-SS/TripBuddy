import { createBooking, updateBooking } from "@/lib/actions";
import { CHANNELS, HOTEL_GROUPS } from "@/lib/constants";
import { formatCalendarDateInput, formatLocalInstantInput } from "@/lib/format";
import { Button, CheckField, Field, FieldGrid, Form, FormActions } from "@/ui";

type BookingFormValue = {
  baselineAwardCount: number | null;
  baselineAwardKind: string | null;
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
    <Form action={booking ? updateBooking : createBooking}>
      {booking ? <input name="bookingId" type="hidden" value={booking.id} /> : null}

      <FieldGrid>
        <Field htmlFor="hotelGroup" label="Hotel group">
          <select defaultValue={booking?.hotelGroup ?? "Hyatt"} id="hotelGroup" name="hotelGroup" required>
            {HOTEL_GROUPS.map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
        </Field>
        <Field htmlFor="hotelName" label="Hotel name">
          <input defaultValue={booking?.hotelName ?? ""} id="hotelName" name="hotelName" placeholder="Grand Hyatt Tokyo" required />
        </Field>
        <Field htmlFor="city" label="City">
          <input defaultValue={booking?.city ?? ""} id="city" name="city" placeholder="Tokyo" required />
        </Field>
        <Field htmlFor="guests" label="Guests">
          <input defaultValue={booking?.guests ?? 1} id="guests" min="1" name="guests" required type="number" />
        </Field>
        <Field htmlFor="checkIn" label="Check-in">
          <input defaultValue={booking ? formatCalendarDateInput(booking.checkIn) : ""} id="checkIn" name="checkIn" required type="date" />
        </Field>
        <Field htmlFor="checkOut" label="Check-out">
          <input defaultValue={booking ? formatCalendarDateInput(booking.checkOut) : ""} id="checkOut" name="checkOut" required type="date" />
        </Field>
        <Field htmlFor="roomType" label="Booked room type">
          <input defaultValue={booking?.roomType ?? ""} id="roomType" name="roomType" placeholder="King Room" required />
        </Field>
        <Field htmlFor="baselineType" label="Booking baseline">
          <select defaultValue={booking?.baselineType ?? "cash"} id="baselineType" name="baselineType">
            <option value="cash">Cash</option>
            <option value="points">Points + optional cash</option>
            <option value="certificate">Free-night certificate</option>
          </select>
        </Field>
        <Field htmlFor="baselineCashTotal" label="Current cash total or points copay">
          <input defaultValue={booking?.baselineCashTotal ?? ""} id="baselineCashTotal" min="0" name="baselineCashTotal" step="0.01" type="number" />
        </Field>
        <Field htmlFor="baselinePoints" label="Current points total">
          <input defaultValue={booking?.baselinePoints ?? ""} id="baselinePoints" min="0" name="baselinePoints" step="1" type="number" />
        </Field>
        <Field htmlFor="baselineAwardLabel" label="Certificate label">
          <input defaultValue={booking?.baselineAwardLabel ?? ""} id="baselineAwardLabel" name="baselineAwardLabel" placeholder="1 Free Night" />
        </Field>
        <Field
          hint="A certificate is priced only when its kind and count are stated."
          htmlFor="baselineAwardKind"
          label="Certificate kind"
        >
          <select defaultValue={booking?.baselineAwardKind ?? ""} id="baselineAwardKind" name="baselineAwardKind">
            <option value="">Not stated</option>
            <option value="free_night">Free-night award</option>
            <option value="suite_upgrade">Suite upgrade award</option>
          </select>
        </Field>
        <Field htmlFor="baselineAwardCount" label="Certificates spent">
          <input defaultValue={booking?.baselineAwardCount ?? ""} id="baselineAwardCount" min="1" name="baselineAwardCount" step="1" type="number" />
        </Field>
        <Field htmlFor="bookingChannel" label="Booking channel">
          <select defaultValue={booking?.bookingChannel ?? "direct"} id="bookingChannel" name="bookingChannel" required>
            {CHANNELS.map((channel) => (
              <option key={channel}>{channel}</option>
            ))}
          </select>
        </Field>
        <Field htmlFor="cancellationDeadline" label="Cancellation deadline">
          <input
            defaultValue={booking ? formatLocalInstantInput(booking.cancellationDeadline) : ""}
            id="cancellationDeadline"
            name="cancellationDeadline"
            type="datetime-local"
          />
        </Field>
        <Field htmlFor="bookingUrl" label="Booking URL">
          <input defaultValue={booking?.bookingUrl ?? ""} id="bookingUrl" name="bookingUrl" placeholder="https://..." type="url" />
        </Field>
      </FieldGrid>

      <FieldGrid>
        <CheckField defaultChecked={booking?.isSuite ?? false} id="isSuite" label="Booked room is a suite" name="isSuite" />
        <CheckField defaultChecked={booking?.breakfastIncluded ?? false} id="breakfastIncluded" label="Breakfast is included" name="breakfastIncluded" />
        <CheckField defaultChecked={booking?.loyaltyEligible ?? true} id="loyaltyEligible" label="Eligible for loyalty credit" name="loyaltyEligible" />
      </FieldGrid>

      <Field htmlFor="notes" label="Notes">
        <textarea defaultValue={booking?.notes ?? ""} id="notes" name="notes" />
      </Field>

      <FormActions>
        <Button type="submit">{booking ? "Save booking" : "Create booking"}</Button>
      </FormActions>
    </Form>
  );
}
