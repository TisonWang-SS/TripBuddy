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
          <span className="muted">Browser profile</span>
          <strong>{chromeProfileName}</strong>
        </div>
      </section>

      <section className="card form">
        <p className="eyebrow">Browser Connector</p>
        <h2>Chrome profile</h2>
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
          <button type="submit">Save Chrome settings</button>
        </form>
      </section>
    </div>
  );
}
