import { BookingForm } from "@/app/components/BookingForm";
import { PageHeader } from "@/ui";

export default function NewBookingPage() {
  return (
    <div className="deskStack">
      <PageHeader
        description="Enter the current cash, points, or free-night certificate baseline."
        eyebrow="Add booking"
        title="Start tracking a stay"
      />
      <BookingForm />
    </div>
  );
}
