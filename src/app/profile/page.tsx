import { createCreditCardBenefit, updateProfile } from "@/lib/actions";
import { DEFAULT_PROFILE_ID, HOTEL_GROUPS, HOTEL_GROUP_TIERS, SUPPORTED_CURRENCIES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { Button, Card, EmptyState, Field, FieldGrid, Form, FormActions, PageHeader, Table } from "@/ui";
import styles from "./page.module.css";

export default async function ProfilePage() {
  const profile = await prisma.userProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: {},
    create: {
      id: DEFAULT_PROFILE_ID,
      name: "Primary Traveler",
      defaultCurrency: "USD",
      savingsThreshold: 50,
      urgentWindowHours: 24,
      breakfastValue: 25,
      loungeValue: 35,
      lateCheckoutValue: 15,
      upgradeValue: 40,
      eliteNightValue: 10
    },
    include: {
      loyaltyAccounts: true,
      creditCardBenefits: true
    }
  });

  const accountByGroup = new Map(profile.loyaltyAccounts.map((account) => [account.hotelGroup, account]));
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
          <Field htmlFor="breakfastValue" label="Breakfast value per night">
            <input defaultValue={profile.breakfastValue} id="breakfastValue" name="breakfastValue" step="0.01" type="number" />
          </Field>
          <Field htmlFor="loungeValue" label="Lounge value per night">
            <input defaultValue={profile.loungeValue} id="loungeValue" name="loungeValue" step="0.01" type="number" />
          </Field>
          <Field htmlFor="lateCheckoutValue" label="Late checkout value">
            <input defaultValue={profile.lateCheckoutValue} id="lateCheckoutValue" name="lateCheckoutValue" step="0.01" type="number" />
          </Field>
          <Field htmlFor="upgradeValue" label="Upgrade value per night">
            <input defaultValue={profile.upgradeValue} id="upgradeValue" name="upgradeValue" step="0.01" type="number" />
          </Field>
          <Field htmlFor="eliteNightValue" label="Elite night value">
            <input defaultValue={profile.eliteNightValue} id="eliteNightValue" name="eliteNightValue" step="0.01" type="number" />
          </Field>
        </FieldGrid>

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
                    <Field htmlFor={`${group}_pointValue`} label="Point value">
                      <input
                        defaultValue={account?.pointValue ?? 0.005}
                        id={`${group}_pointValue`}
                        name={`${group}_pointValue`}
                        step="0.0001"
                        type="number"
                      />
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
