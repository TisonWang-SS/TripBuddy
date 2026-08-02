import Link from "next/link";
import { notFound } from "next/navigation";
import { ObservationForm } from "@/app/components/ObservationForm";
import { prisma } from "@/lib/db";

export default async function NewObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({ where: { id } });
  if (!booking) {
    notFound();
  }
  return (
    <div className="grid">
      <div className="pageHeader"><div><p className="eyebrow">Manual entry</p><h1>{booking.hotelName}</h1><p>Fallback input for a final price that the Browser Companion could not capture.</p></div><Link className="button secondary" href={`/bookings/${id}`}>Back</Link></div>
      <ObservationForm booking={booking} />
    </div>
  );
}
