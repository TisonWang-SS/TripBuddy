import Link from "next/link";
import { notFound } from "next/navigation";
import { ObservationForm } from "@/app/components/ObservationForm";
import { prisma } from "@/lib/db";
import { formatLocalInstant } from "@/lib/format";
import { buttonClassName, PageHeader } from "@/ui";

export default async function EditObservationPage({ params }: { params: Promise<{ id: string; observationId: string }> }) {
  const { id, observationId } = await params;
  const observation = await prisma.priceObservation.findUnique({ where: { id: observationId }, include: { booking: true, evidence: true } });
  if (!observation || observation.bookingId !== id) {
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
        description={`${observation.sourceName} · ${formatLocalInstant(observation.observedAt)}`}
        eyebrow="Review observation"
        title={observation.booking.hotelName}
      />
      <ObservationForm booking={observation.booking} observation={observation} />
    </div>
  );
}
