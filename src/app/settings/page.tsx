import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { updateChromeSettings } from "@/lib/actions";
import { defaultChromeUserDataDir } from "@/lib/browserConnector";

export default async function SettingsPage() {
  const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });
  const chromeProfileName = profile?.chromeProfileName ?? "TripBuddy";
  const configuredDirectory = profile?.chromeProfileDirectory ?? "";
  const chromeUserDataDir = profile?.chromeUserDataDir ?? defaultChromeUserDataDir();

  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Local controls for the first version.</h1>
          <p>Automation and notifications are intentionally placeholders until the manual loop is stable.</p>
        </div>
      </div>

      <section className="grid two">
        <div className="card">
          <h2>Default currency</h2>
          <p>{profile?.defaultCurrency ?? "USD"}</p>
          <p>Currency conversion is not automatic in this version. Use matching currencies for reliable decisions.</p>
        </div>
        <div className="card">
          <h2>Automation status</h2>
          <p>Chrome profile checks are available.</p>
          <p>TripBuddy connects to a real local Chrome browser through Chrome DevTools Protocol.</p>
        </div>
        <div className="card">
          <h2>Recommendation threshold</h2>
          <p>{profile?.savingsThreshold ?? 50}</p>
          <p>Direct rebooking recommendations require estimated savings above this value.</p>
        </div>
        <div className="card">
          <h2>Notification status</h2>
          <p>In-app dashboard only.</p>
          <p>Email, Telegram, and calendar-aware reminders are out of scope for v0.1.</p>
        </div>
      </section>

      <section className="card form">
        <p className="eyebrow">Browser Connector</p>
        <h2>Chrome profile</h2>
        <p>
          Use a dedicated Chrome data directory for hotel checks. Keep hotel logins and cookies here instead of using your
          daily browser profile.
        </p>
        <form action={updateChromeSettings} className="form">
          <div className="grid three">
            <div className="field">
              <label htmlFor="chromeProfileName">Session name</label>
              <input id="chromeProfileName" name="chromeProfileName" defaultValue={chromeProfileName} />
            </div>
            <div className="field">
              <label htmlFor="chromeUserDataDir">Chrome data directory</label>
              <input id="chromeUserDataDir" name="chromeUserDataDir" defaultValue={chromeUserDataDir} />
            </div>
            <div className="field">
              <label htmlFor="chromeDebugPort">Debug port</label>
              <input id="chromeDebugPort" name="chromeDebugPort" type="number" min="0" max="65535" defaultValue={profile?.chromeDebugPort ?? 0} />
            </div>
          </div>
          <input type="hidden" name="chromeProfileDirectory" value={configuredDirectory} />
          <p className="muted">Chrome will keep hotel sessions in this local directory. Use port 0 for automatic port selection.</p>
          <button type="submit">Save Chrome settings</button>
        </form>
      </section>
    </div>
  );
}
