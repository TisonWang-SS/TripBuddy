import { notFound } from "next/navigation";
import Link from "next/link";
import { updateWatchPlan } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { formatLocalInstant } from "@/lib/format";
import {
  Button,
  buttonClassName,
  CheckField,
  Field,
  FieldGrid,
  Figure,
  Figures,
  Form,
  FormActions,
  Notice,
  PageHeader
} from "@/ui";

export default async function WatchPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: { watchPlan: true }
  });

  if (!booking) {
    notFound();
  }

  return (
    <div className="deskStack">
      <PageHeader
        actions={
          <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href={`/bookings/${booking.id}`}>
            Back
          </Link>
        }
        description="Choose which inventory the next Browser Companion check should collect."
        eyebrow="Watch plan"
        title={booking.hotelName}
      />

      <Figures>
        <Figure label="Last checked" value={formatLocalInstant(booking.watchPlan?.lastCheckedAt)} />
        <Figure label="Last attempted" value={formatLocalInstant(booking.watchPlan?.lastAttemptedAt)} />
        <Figure label="Consecutive failures" value={booking.watchPlan?.consecutiveFailures ?? 0} />
      </Figures>

      <Form action={updateWatchPlan}>
        <input name="bookingId" type="hidden" value={booking.id} />

        <FieldGrid>
          <CheckField
            defaultChecked={booking.watchPlan?.cashEnabled ?? true}
            id="cashEnabled"
            label="Check cash rates"
            name="cashEnabled"
          />
          <CheckField
            defaultChecked={booking.watchPlan?.awardEnabled ?? true}
            id="awardEnabled"
            label="Check award rates (opens Hyatt in points mode)"
            name="awardEnabled"
          />
        </FieldGrid>
        {/*
          Not a preference pair: Hyatt's rooms page is either cash or points,
          and the mode is fixed in the URL this check launches. Ticking award
          therefore decides the whole run, which the labels above must not let
          a reader discover only from the result.
        */}
        <Notice tone="info">
          Hyatt shows one mode per page, so ticking award rates puts the whole check in points mode. Leave it unticked to
          collect a cash total.
        </Notice>

        <FieldGrid>
          <Field htmlFor="normalCadenceHours" label="Normal reminder cadence (hours)">
            <input
              defaultValue={booking.watchPlan?.normalCadenceHours ?? 24}
              id="normalCadenceHours"
              max="720"
              min="1"
              name="normalCadenceHours"
              type="number"
            />
          </Field>
          <Field htmlFor="urgentCadenceHours" label="Urgent reminder cadence (hours)">
            <input
              defaultValue={booking.watchPlan?.urgentCadenceHours ?? 6}
              id="urgentCadenceHours"
              max="720"
              min="1"
              name="urgentCadenceHours"
              type="number"
            />
          </Field>
          <Field htmlFor="urgentWindowHours" label="Urgent window before cancellation (hours)">
            <input
              defaultValue={booking.watchPlan?.urgentWindowHours ?? 72}
              id="urgentWindowHours"
              max="720"
              min="1"
              name="urgentWindowHours"
              type="number"
            />
          </Field>
        </FieldGrid>

        <Notice>
          These values create reminders on the desk. Every check still needs you to press Run price check and keep the
          visible Hyatt tab open.
        </Notice>

        <FormActions>
          <Button type="submit">Save watch plan</Button>
        </FormActions>
      </Form>
    </div>
  );
}
