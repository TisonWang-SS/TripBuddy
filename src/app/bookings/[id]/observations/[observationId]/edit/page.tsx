import Link from "next/link";
import { notFound } from "next/navigation";
import { ObservationForm } from "@/app/components/ObservationForm";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function EditObservationPage({ params }: { params: Promise<{ id: string; observationId: string }> }) {
  const { id, observationId } = await params;
  const observation = await prisma.priceObservation.findUnique({ where: { id: observationId }, include: { booking: true, evidence: true } });
  if (!observation || observation.bookingId !== id) {
    notFound();
  }
  return (
    <div className="grid">
      <div className="pageHeader"><div><p className="eyebrow">Review observation</p><h1>{observation.booking.hotelName}</h1><p>{observation.sourceName} · {formatDateTime(observation.observedAt)}</p></div><Link className="button secondary" href={`/bookings/${id}`}>Back</Link></div>
      <ObservationForm booking={observation.booking} observation={observation} />
    </div>
  );
}
