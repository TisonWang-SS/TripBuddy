import { BookingForm } from "@/app/components/BookingForm";

export default function NewBookingPage() {
  return (
    <div className="grid">
      <div className="pageHeader"><div><p className="eyebrow">Add booking</p><h1>Start tracking a hotel stay.</h1><p>Enter the current cash, points, or free-night certificate baseline.</p></div></div>
      <BookingForm />
    </div>
  );
}
