import { createCreditCardBenefit, saveLoyaltyValuation, updateProfile } from "@/lib/actions";
import { DEFAULT_PROFILE_ID, HOTEL_GROUPS, HOTEL_GROUP_TIERS, SUPPORTED_CURRENCIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatCalendarDate } from "@/lib/format";
import { loyaltyValuationKindLabel } from "@/lib/labels";
import { isValuationStale, VALUATION_REVIEW_INTERVAL_DAYS, valuationReviewDueAt } from "@/lib/loyaltyValuation";
import { Button, Card, CheckField, EmptyState, Field, FieldGrid, Form, FormActions, LabelStamp, PageHeader, Table } from "@/ui";
import styles from "./page.module.css";

const VALUATION_KINDS = ["point", "free_night", "suite_upgrade"] as const;

export default async function ProfilePage() {
  const profile = await prisma.userProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: {},
    create: {
      id: DEFAULT_PROFILE_ID,
      name: "Primary Traveler",
      defaultCurrency: "USD",
      savingsThreshold: 50,
      urgentWindowHours: 24
    },
    include: {
      loyaltyAccounts: true,
      creditCardBenefits: true,
      loyaltyValuations: { orderBy: [{ hotelGroup: "asc" }, { kind: "asc" }] }
    }
  });

  const accountByGroup = new Map(profile.loyaltyAccounts.map((account) => [account.hotelGroup, account]));
  const now = new Date();
  return (
    <div className="deskStack">
      <PageHeader
        description="Store stable assumptions once, then let recommendations use them on every booking."
        eyebrow="Profile & loyalty"
        title="Your travel math"
      />

      <Form action={updateProfile}>
        <PageHeader eyebrow="Traveler profile" level={2} title="Default values" />

        <FieldGrid>
          <Field htmlFor="name" label="Profile name">
            <input defaultValue={profile.name} id="name" name="name" />
          </Field>
          <Field
            hint="City search captures and displays one official price in this currency."
            htmlFor="defaultCurrency"
            label="Primary calculation currency"
          >
            <select defaultValue={profile.defaultCurrency} id="defaultCurrency" name="defaultCurrency">
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="savingsThreshold" label="Savings threshold">
            <input defaultValue={profile.savingsThreshold} id="savingsThreshold" name="savingsThreshold" step="0.01" type="number" />
          </Field>
          <Field htmlFor="urgentWindowHours" label="Urgent window hours">
            <input defaultValue={profile.urgentWindowHours} id="urgentWindowHours" name="urgentWindowHours" type="number" />
          </Field>
        </FieldGrid>

        <section>
          <PageHeader
            description="Untick an entitlement you do not care about. Preferences suppress loss warnings; they never change cost or verdicts."
            eyebrow="Entitlement preferences"
            level={2}
            title="Warn me when a candidate drops"
          />
          <FieldGrid>
            <CheckField defaultChecked={profile.caresAboutBreakfast} id="caresAboutBreakfast" label="Breakfast" name="caresAboutBreakfast" />
            <CheckField defaultChecked={profile.caresAboutLounge} id="caresAboutLounge" label="Lounge access" name="caresAboutLounge" />
            <CheckField defaultChecked={profile.caresAboutLateCheckout} id="caresAboutLateCheckout" label="Late checkout" name="caresAboutLateCheckout" />
            <CheckField defaultChecked={profile.caresAboutUpgrade} id="caresAboutUpgrade" label="Room upgrades" name="caresAboutUpgrade" />
          </FieldGrid>
        </section>

        <section>
          <PageHeader eyebrow="Loyalty accounts" level={2} title="Hotel program status" />
          <div className={styles.programs}>
            {HOTEL_GROUPS.map((group) => {
              const account = accountByGroup.get(group);
              return (
                <div className={styles.program} key={group}>
                  <h3 className={styles.programName}>{group}</h3>
                  <FieldGrid>
                    <Field htmlFor={`${group}_tier`} label="Tier">
                      <select
                        defaultValue={account?.tier ?? HOTEL_GROUP_TIERS[group][0]}
                        id={`${group}_tier`}
                        name={`${group}_tier`}
                      >
                        {HOTEL_GROUP_TIERS[group].map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </FieldGrid>
                </div>
              );
            })}
          </div>
        </section>

        <FormActions>
          <Button type="submit">Save profile</Button>
        </FormActions>
      </Form>

      <Card eyebrow="Sourced valuations" title="What a point or certificate is worth">
        <p>
          Only figures someone else quotes a price for enter a cost. Each one records its source and the date it was last
          checked; after {VALUATION_REVIEW_INTERVAL_DAYS} days it is named as stale in every recommendation that uses it
          rather than quietly trusted or dropped.
        </p>
        {profile.loyaltyValuations.length === 0 ? (
          <EmptyState
            description="Until a point value is recorded, a stay paid with points or a certificate cannot be priced."
            title="No valuations recorded"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Figure</th>
                <th scope="col">Value</th>
                <th scope="col">Realization</th>
                <th scope="col">Source</th>
                <th scope="col">Reviewed</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {profile.loyaltyValuations.map((valuation) => (
                <tr key={valuation.id}>
                  <td>{valuation.hotelGroup}</td>
                  <td>{loyaltyValuationKindLabel(valuation.kind).label}</td>
                  <td>
                    {valuation.amount} {valuation.currency}
                    <span className={styles.stacked}>Quoted as of {formatCalendarDate(valuation.asOf)}</span>
                  </td>
                  <td>{valuation.realizationRate}</td>
                  <td>{valuation.sourceName}</td>
                  <td>{formatCalendarDate(valuation.lastReviewedAt)}</td>
                  <td>
                    <LabelStamp
                      value={
                        isValuationStale(valuation, now)
                          ? { label: "Past review", tone: "caution" }
                          : { label: "Current", tone: "positive" }
                      }
                    />
                    <span className={styles.stacked}>Due {formatCalendarDate(valuationReviewDueAt(valuation))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Form action={saveLoyaltyValuation}>
        <PageHeader
          description="A realization rate below 1 is for a traveler who clears fewer awards than the market assumes. It adjusts the quoted price and never applies to points."
          eyebrow="Add or update valuation"
          level={2}
          title="Sourced valuation"
        />
        <FieldGrid>
          <Field htmlFor="valuationHotelGroup" label="Hotel group">
            <select id="valuationHotelGroup" name="hotelGroup">
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="valuationKind" label="Figure">
            <select id="valuationKind" name="kind">
              {VALUATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {loyaltyValuationKindLabel(kind).label}
                </option>
              ))}
            </select>
          </Field>
          <Field hint="Per point, or per certificate" htmlFor="valuationAmount" label="Market value">
            <input id="valuationAmount" min="0.000001" name="amount" placeholder="0.017" required step="any" type="number" />
          </Field>
          <Field htmlFor="valuationCurrency" label="Currency">
            <select defaultValue={profile.defaultCurrency} id="valuationCurrency" name="currency">
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
          <Field hint="1 trusts the quote" htmlFor="valuationRealizationRate" label="Realization rate">
            <input
              defaultValue="1"
              id="valuationRealizationRate"
              max="1"
              min="0.01"
              name="realizationRate"
              step="0.01"
              type="number"
            />
          </Field>
          <Field htmlFor="valuationSourceName" label="Source">
            <input id="valuationSourceName" name="sourceName" placeholder="Points guy valuations" required />
          </Field>
          <Field htmlFor="valuationAsOf" label="Quoted as of">
            <input defaultValue={new Date().toISOString().slice(0, 10)} id="valuationAsOf" name="asOf" required type="date" />
          </Field>
          <Field htmlFor="valuationLastReviewedAt" label="Last reviewed">
            <input
              defaultValue={new Date().toISOString().slice(0, 10)}
              id="valuationLastReviewedAt"
              name="lastReviewedAt"
              required
              type="date"
            />
          </Field>
        </FieldGrid>
        <FormActions>
          <Button type="submit">Save valuation</Button>
        </FormActions>
      </Form>

      <Card eyebrow="Credit cards" title="Benefit cards">
        {profile.creditCardBenefits.length === 0 ? (
          <EmptyState description="Add cards that provide hotel cash back or extra points." title="No credit card benefits" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Group</th>
                <th scope="col">Cash back</th>
                <th scope="col">Point multiplier</th>
              </tr>
            </thead>
            <tbody>
              {profile.creditCardBenefits.map((card) => (
                <tr key={card.id}>
                  <td>{card.name}</td>
                  <td>{card.hotelGroup ?? "Any"}</td>
                  <td>{card.cashBackRate}</td>
                  <td>{card.pointMultiplier}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Form action={createCreditCardBenefit}>
        <PageHeader eyebrow="Add card benefit" level={2} title="New card" />
        <FieldGrid>
          <Field htmlFor="cardName" label="Card name">
            <input id="cardName" name="name" placeholder="Hotel card" required />
          </Field>
          <Field htmlFor="cardHotelGroup" label="Hotel group">
            <select id="cardHotelGroup" name="hotelGroup">
              <option value="">Any group</option>
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </Field>
          <Field htmlFor="cashBackRate" label="Cash back rate">
            <input defaultValue="0" id="cashBackRate" name="cashBackRate" step="0.001" type="number" />
          </Field>
          <Field htmlFor="pointMultiplier" label="Point multiplier">
            <input defaultValue="0" id="pointMultiplier" name="pointMultiplier" step="0.1" type="number" />
          </Field>
        </FieldGrid>
        <Field htmlFor="cardNotes" label="Notes">
          <textarea id="cardNotes" name="notes" />
        </Field>
        <FormActions>
          <Button type="submit">Add card benefit</Button>
        </FormActions>
      </Form>
    </div>
  );
}
