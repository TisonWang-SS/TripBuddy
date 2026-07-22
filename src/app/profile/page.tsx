import { createCreditCardBenefit, updateProfile } from "@/lib/actions";
import { DEFAULT_PROFILE_ID, HOTEL_GROUPS, HOTEL_GROUP_TIERS } from "@/lib/constants";
import { prisma } from "@/lib/db";

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
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Profile & Loyalty</p>
          <h1>Model your personal travel math.</h1>
          <p>Store stable assumptions once, then let recommendations use them on every booking.</p>
        </div>
      </div>

      <form action={updateProfile} className="card form">
        <p className="eyebrow">Traveler Profile</p>
        <h2>Default values</h2>
        <div className="grid three">
          <div className="field">
            <label htmlFor="name">Profile name</label>
            <input id="name" name="name" defaultValue={profile.name} />
          </div>
          <div className="field">
            <label htmlFor="defaultCurrency">Default currency</label>
            <input id="defaultCurrency" name="defaultCurrency" defaultValue={profile.defaultCurrency} />
          </div>
          <div className="field">
            <label htmlFor="savingsThreshold">Savings threshold</label>
            <input
              id="savingsThreshold"
              name="savingsThreshold"
              type="number"
              step="0.01"
              defaultValue={profile.savingsThreshold}
            />
          </div>
          <div className="field">
            <label htmlFor="urgentWindowHours">Urgent window hours</label>
            <input id="urgentWindowHours" name="urgentWindowHours" type="number" defaultValue={profile.urgentWindowHours} />
          </div>
          <div className="field">
            <label htmlFor="breakfastValue">Breakfast value per night</label>
            <input id="breakfastValue" name="breakfastValue" type="number" step="0.01" defaultValue={profile.breakfastValue} />
          </div>
          <div className="field">
            <label htmlFor="loungeValue">Lounge value per night</label>
            <input id="loungeValue" name="loungeValue" type="number" step="0.01" defaultValue={profile.loungeValue} />
          </div>
          <div className="field">
            <label htmlFor="lateCheckoutValue">Late checkout value</label>
            <input
              id="lateCheckoutValue"
              name="lateCheckoutValue"
              type="number"
              step="0.01"
              defaultValue={profile.lateCheckoutValue}
            />
          </div>
          <div className="field">
            <label htmlFor="upgradeValue">Upgrade value per night</label>
            <input id="upgradeValue" name="upgradeValue" type="number" step="0.01" defaultValue={profile.upgradeValue} />
          </div>
          <div className="field">
            <label htmlFor="eliteNightValue">Elite night value</label>
            <input id="eliteNightValue" name="eliteNightValue" type="number" step="0.01" defaultValue={profile.eliteNightValue} />
          </div>
        </div>

        <div className="section">
          <p className="eyebrow">Loyalty Accounts</p>
          <h2>Hotel program status</h2>
          <div className="grid">
            {HOTEL_GROUPS.map((group) => {
              const account = accountByGroup.get(group);
              return (
                <div className="card flat" key={group}>
                  <h3>{group}</h3>
                  <div className="grid three">
                    <div className="field">
                      <label htmlFor={`${group}_tier`}>Tier</label>
                      <select id={`${group}_tier`} name={`${group}_tier`} defaultValue={account?.tier ?? HOTEL_GROUP_TIERS[group][0]}>
                        {HOTEL_GROUP_TIERS[group].map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`${group}_targetTier`}>Target tier</label>
                      <select id={`${group}_targetTier`} name={`${group}_targetTier`} defaultValue={account?.targetTier ?? ""}>
                        <option value="">No target</option>
                        {HOTEL_GROUP_TIERS[group].map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`${group}_pointValue`}>Point value</label>
                      <input
                        id={`${group}_pointValue`}
                        name={`${group}_pointValue`}
                        type="number"
                        step="0.0001"
                        defaultValue={account?.pointValue ?? 0.005}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${group}_currentNights`}>Current nights</label>
                      <input
                        id={`${group}_currentNights`}
                        name={`${group}_currentNights`}
                        type="number"
                        defaultValue={account?.currentNights ?? 0}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${group}_currentPoints`}>Current points</label>
                      <input
                        id={`${group}_currentPoints`}
                        name={`${group}_currentPoints`}
                        type="number"
                        defaultValue={account?.currentPoints ?? 0}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${group}_currentSpend`}>Current spend</label>
                      <input
                        id={`${group}_currentSpend`}
                        name={`${group}_currentSpend`}
                        type="number"
                        step="0.01"
                        defaultValue={account?.currentSpend ?? 0}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <button type="submit">Save profile</button>
      </form>

      <section className="card">
        <p className="eyebrow">Credit Cards</p>
        <h2>Benefit cards</h2>
        <div className="divider" />
        {profile.creditCardBenefits.length === 0 ? (
          <div className="empty">
            <h3>No credit card benefits</h3>
            <p>Add cards that provide hotel cash back, extra points, or elite night credits.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Cash back</th>
                <th>Point multiplier</th>
                <th>Elite nights</th>
              </tr>
            </thead>
            <tbody>
              {profile.creditCardBenefits.map((card) => (
                <tr key={card.id}>
                  <td>{card.name}</td>
                  <td>{card.hotelGroup ?? "Any"}</td>
                  <td>{card.cashBackRate}</td>
                  <td>{card.pointMultiplier}</td>
                  <td>{card.eliteNightCredits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form action={createCreditCardBenefit} className="card form">
        <p className="eyebrow">Add Card Benefit</p>
        <div className="grid three">
          <div className="field">
            <label htmlFor="cardName">Card name</label>
            <input id="cardName" name="name" required placeholder="Hotel card" />
          </div>
          <div className="field">
            <label htmlFor="cardHotelGroup">Hotel group</label>
            <select id="cardHotelGroup" name="hotelGroup">
              <option value="">Any group</option>
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cashBackRate">Cash back rate</label>
            <input id="cashBackRate" name="cashBackRate" type="number" step="0.001" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="pointMultiplier">Point multiplier</label>
            <input id="pointMultiplier" name="pointMultiplier" type="number" step="0.1" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="eliteNightCredits">Elite night credits</label>
            <input id="eliteNightCredits" name="eliteNightCredits" type="number" defaultValue="0" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cardNotes">Notes</label>
          <textarea id="cardNotes" name="notes" />
        </div>
        <button type="submit">Add card benefit</button>
      </form>
    </div>
  );
}
