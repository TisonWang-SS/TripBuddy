import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";

export default async function SettingsPage() {
  const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });

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
          <span className="muted">Default currency</span>
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
    </div>
  );
}
