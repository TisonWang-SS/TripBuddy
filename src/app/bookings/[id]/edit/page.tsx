import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingForm } from "@/app/components/BookingForm";
import { prisma } from "@/lib/db";
import { buttonClassName, PageHeader } from "@/ui";

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({ where: { id } });
  if (!booking) {
    notFound();
  }
  return (
    <div className="deskStack">
      <PageHeader
        actions={
          <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href={`/bookings/${id}`}>
            Back
          </Link>
        }
        description="Correct the current booking baseline and matching details."
        eyebrow="Edit booking"
        title={booking.hotelName}
      />
      <BookingForm booking={booking} />
    </div>
  );
}
