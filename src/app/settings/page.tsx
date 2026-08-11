import { saveCurrencyConversionRate } from "@/lib/actions";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate } from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldGrid,
  Figure,
  Figures,
  Form,
  FormActions,
  PageHeader,
  Table
} from "@/ui";

export default async function SettingsPage() {
  const [profile, settings] = await Promise.all([
    prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } }),
    prisma.systemSetting.findUnique({
      where: { id: "primary" },
      include: { conversionRates: { orderBy: [{ sourceCurrency: "asc" }, { asOf: "desc" }] } }
    })
  ]);
  const calculationCurrency = settings?.displayCurrency ?? profile?.defaultCurrency ?? "USD";
  const conversionRates = settings?.conversionRates.filter(
    (rate) => rate.targetCurrency === calculationCurrency
  ) ?? [];

  return (
    <div className="deskStack">
      <PageHeader
        description="Configure browser automation and recommendation defaults."
        eyebrow="Settings"
        title="Local controls"
      />

      <Figures>
        <Figure label="Calculation currency" value={calculationCurrency} />
        <Figure label="Hotel search currency" value={profile?.defaultCurrency ?? "USD"} />
        <Figure label="Savings threshold" value={profile?.savingsThreshold ?? 50} />
        <Figure label="Browser access" value="Companion" />
      </Figures>

      <Card eyebrow="Browser access" title="Normal Chrome">
        <p>Hyatt searches and imports open in Chrome and use the TripBuddy Browser Companion.</p>
      </Card>

      <Card eyebrow="Currency conversion" title={`Observed currencies to ${calculationCurrency}`}>
        <p>
          Rates make foreign-currency observations comparable. Existing observations should be reviewed or re-run after
          adding a rate.
        </p>
        {conversionRates.length ? (
          <Table>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Rate</th>
                <th scope="col">As of</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {conversionRates.map((rate) => (
                <tr key={rate.id}>
                  <td>{rate.sourceCurrency}</td>
                  <td>{rate.targetCurrency}</td>
                  <td>{rate.rate}</td>
                  <td>{formatCalendarDate(rate.asOf)}</td>
                  <td>{rate.sourceName ?? "Manual"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState description="Same-currency observations use an implicit rate of 1." title="No conversion rates" />
        )}
      </Card>

      <Form action={saveCurrencyConversionRate}>
        <PageHeader eyebrow="Add or update rate" level={2} title="Conversion rate" />
        <FieldGrid>
          <Field htmlFor="sourceCurrency" label="Observed currency">
            <input id="sourceCurrency" maxLength={3} name="sourceCurrency" pattern="[A-Za-z]{3}" placeholder="JPY" required />
          </Field>
          <Field hint={`Amount in ${calculationCurrency}`} htmlFor="rate" label="1 observed unit equals">
            <input id="rate" min="0.00000001" name="rate" placeholder="0.0067" required step="any" type="number" />
          </Field>
          <Field htmlFor="asOf" label="Rate date">
            <input defaultValue={new Date().toISOString().slice(0, 10)} id="asOf" name="asOf" required type="date" />
          </Field>
          <Field htmlFor="sourceName" label="Source">
            <input id="sourceName" name="sourceName" placeholder="Manual / bank statement" />
          </Field>
        </FieldGrid>
        <FormActions>
          <Button type="submit">Save conversion rate</Button>
        </FormActions>
      </Form>
    </div>
  );
}
