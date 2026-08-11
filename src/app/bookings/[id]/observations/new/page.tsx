import Link from "next/link";
import { notFound } from "next/navigation";
import { ObservationForm } from "@/app/components/ObservationForm";
import { prisma } from "@/lib/db";
import { buttonClassName, PageHeader } from "@/ui";

export default async function NewObservationPage({ params }: { params: Promise<{ id: string }> }) {
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
        description="Fallback input for a final price the Browser Companion could not capture."
        eyebrow="Manual entry"
        title={booking.hotelName}
      />
      <ObservationForm booking={booking} />
    </div>
  );
}
