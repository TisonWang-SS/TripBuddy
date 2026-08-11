import { saveCurrencyConversionRate } from "@/lib/actions";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate } from "@/lib/format";

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
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Local controls</h1>
          <p>Configure browser automation and recommendation defaults.</p>
        </div>
      </div>

      <section className="grid three">
        <div className="card flat metric">
          <span className="muted">Primary calculation currency</span>
          <strong>{calculationCurrency}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Hotel search currency</span>
          <strong>{profile?.defaultCurrency ?? "USD"}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Savings threshold</span>
          <strong>{profile?.savingsThreshold ?? 50}</strong>
        </div>
        <div className="card flat metric">
          <span className="muted">Browser access</span>
          <strong>Companion extension</strong>
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">Browser access</p>
        <h2>Normal Chrome</h2>
        <p>Hyatt searches and imports open in Chrome and use the TripBuddy Browser Companion.</p>
      </section>

      <section className="card">
        <p className="eyebrow">Currency conversion</p>
        <h2>Observed currencies to {calculationCurrency}</h2>
        <p>Rates make foreign-currency observations comparable. Existing observations should be reviewed or re-run after adding a rate.</p>
        {conversionRates.length ? (
          <table className="table">
            <thead><tr><th>From</th><th>To</th><th>Rate</th><th>As of</th><th>Source</th></tr></thead>
            <tbody>{conversionRates.map((rate) => (
              <tr key={rate.id}>
                <td>{rate.sourceCurrency}</td>
                <td>{rate.targetCurrency}</td>
                <td>{rate.rate}</td>
                <td>{formatCalendarDate(rate.asOf)}</td>
                <td>{rate.sourceName ?? "Manual"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><h3>No conversion rates</h3><p>Same-currency observations use an implicit rate of 1.</p></div>}
      </section>

      <form action={saveCurrencyConversionRate} className="card form">
        <p className="eyebrow">Add or update rate</p>
        <div className="grid three">
          <div className="field">
            <label htmlFor="sourceCurrency">Observed currency</label>
            <input id="sourceCurrency" maxLength={3} name="sourceCurrency" pattern="[A-Za-z]{3}" placeholder="JPY" required />
          </div>
          <div className="field">
            <label htmlFor="rate">1 observed unit equals</label>
            <input id="rate" min="0.00000001" name="rate" placeholder="0.0067" required step="any" type="number" />
            <small className="muted">Amount in {calculationCurrency}</small>
          </div>
          <div className="field">
            <label htmlFor="asOf">Rate date</label>
            <input id="asOf" name="asOf" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="field">
            <label htmlFor="sourceName">Source</label>
            <input id="sourceName" name="sourceName" placeholder="Manual / bank statement" />
          </div>
        </div>
        <button type="submit">Save conversion rate</button>
      </form>
    </div>
  );
}
