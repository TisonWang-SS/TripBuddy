import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingForm } from "@/app/components/BookingForm";
import { prisma } from "@/lib/db";

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({ where: { id } });
  if (!booking) {
    notFound();
  }
  return (
    <div className="grid">
      <div className="pageHeader"><div><p className="eyebrow">Edit booking</p><h1>{booking.hotelName}</h1><p>Correct the current booking baseline and matching details.</p></div><Link className="button secondary" href={`/bookings/${id}`}>Back</Link></div>
      <BookingForm booking={booking} />
    </div>
  );
}
