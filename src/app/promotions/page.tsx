import { createPromotion } from "@/lib/actions";
import { HOTEL_GROUPS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate } from "@/lib/format";
import {
  Button,
  Card,
  CheckField,
  EmptyState,
  Field,
  FieldGrid,
  Form,
  FormActions,
  PageHeader,
  Table
} from "@/ui";

export default async function PromotionsPage() {
  const promotions = await prisma.promotion.findMany({
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="deskStack">
      <PageHeader
        description="Add hotel promotions by hand from official pages, emails, screenshots, or copied terms."
        eyebrow="Promotions"
        title="Capture offers before they go"
      />

      <Form action={createPromotion}>
        <PageHeader eyebrow="Add promotion" level={2} title="New offer" />

        <FieldGrid>
          <Field htmlFor="hotelGroup" label="Hotel group">
            <select id="hotelGroup" name="hotelGroup" required>
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="title" label="Title">
            <input id="title" name="title" placeholder="Double points on eligible stays" required />
          </Field>
          <Field htmlFor="startDate" label="Start date">
            <input id="startDate" name="startDate" type="date" />
          </Field>
          <Field htmlFor="endDate" label="End date">
            <input id="endDate" name="endDate" type="date" />
          </Field>
          <Field htmlFor="bonusMultiplier" label="Bonus multiplier">
            <input defaultValue="0" id="bonusMultiplier" name="bonusMultiplier" step="0.1" type="number" />
          </Field>
          <Field htmlFor="flatValue" label="Flat value">
            <input defaultValue="0" id="flatValue" name="flatValue" step="0.01" type="number" />
          </Field>
          <Field htmlFor="sourceUrl" label="Source URL">
            <input id="sourceUrl" name="sourceUrl" placeholder="https://..." type="url" />
          </Field>
        </FieldGrid>

        <Field htmlFor="description" label="Terms or notes">
          <textarea id="description" name="description" placeholder="Paste the important promotion terms here." />
        </Field>

        <FieldGrid>
          <CheckField id="requiresRegistration" label="Registration is required" name="requiresRegistration" />
          <CheckField id="appliesToExistingBookings" label="Applies to existing bookings" name="appliesToExistingBookings" />
        </FieldGrid>

        <FormActions>
          <Button type="submit">Save promotion</Button>
        </FormActions>
      </Form>

      <Card eyebrow="Saved offers" title="Promotion library">
        {promotions.length === 0 ? (
          <EmptyState
            description="Add a promotion to include it in future effective-cost calculations."
            title="No promotions yet"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Title</th>
                <th scope="col">Dates</th>
                <th scope="col">Value</th>
                <th scope="col">Rules</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <td>{promotion.hotelGroup}</td>
                  <td>{promotion.title}</td>
                  <td>
                    {formatCalendarDate(promotion.startDate)} to {formatCalendarDate(promotion.endDate)}
                  </td>
                  <td>
                    {promotion.bonusMultiplier}x bonus · {promotion.flatValue} flat
                  </td>
                  <td>
                    {promotion.requiresRegistration ? "Registration required" : "No registration flag"}
                    <br />
                    {promotion.appliesToExistingBookings ? "Existing bookings included" : "New bookings only"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
