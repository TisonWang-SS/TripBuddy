import { createPromotion } from "@/lib/actions";
import { HOTEL_GROUPS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export default async function PromotionsPage() {
  const promotions = await prisma.promotion.findMany({
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Promotions</p>
          <h1>Capture offers before they disappear.</h1>
          <p>Add hotel promotions manually from official pages, emails, screenshots, or copied terms.</p>
        </div>
      </div>

      <form action={createPromotion} className="card form">
        <p className="eyebrow">Add Promotion</p>
        <div className="grid two">
          <div className="field">
            <label htmlFor="hotelGroup">Hotel group</label>
            <select id="hotelGroup" name="hotelGroup" required>
              {HOTEL_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required placeholder="Double points on eligible stays" />
          </div>
          <div className="field">
            <label htmlFor="startDate">Start date</label>
            <input id="startDate" name="startDate" type="date" />
          </div>
          <div className="field">
            <label htmlFor="endDate">End date</label>
            <input id="endDate" name="endDate" type="date" />
          </div>
          <div className="field">
            <label htmlFor="bonusMultiplier">Bonus multiplier</label>
            <input id="bonusMultiplier" name="bonusMultiplier" type="number" step="0.1" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="flatValue">Flat value</label>
            <input id="flatValue" name="flatValue" type="number" step="0.01" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="sourceUrl">Source URL</label>
            <input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://..." />
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Terms or notes</label>
          <textarea id="description" name="description" placeholder="Paste the important promotion terms here." />
        </div>
        <div className="check">
          <input id="requiresRegistration" name="requiresRegistration" type="checkbox" />
          <label htmlFor="requiresRegistration">Registration is required</label>
        </div>
        <div className="check">
          <input id="appliesToExistingBookings" name="appliesToExistingBookings" type="checkbox" />
          <label htmlFor="appliesToExistingBookings">Applies to existing bookings</label>
        </div>
        <button type="submit">Save promotion</button>
      </form>

      <section className="card">
        <p className="eyebrow">Saved Offers</p>
        <h2>Promotion library</h2>
        <div className="divider" />
        {promotions.length === 0 ? (
          <div className="empty">
            <h3>No promotions yet</h3>
            <p>Add a promotion to include it in future effective cost calculations.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Title</th>
                <th>Dates</th>
                <th>Value</th>
                <th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <td>{promotion.hotelGroup}</td>
                  <td>{promotion.title}</td>
                  <td>
                    {formatDate(promotion.startDate)} to {formatDate(promotion.endDate)}
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
          </table>
        )}
      </section>
    </div>
  );
}
