# TripBuddy Browser Companion

The unpacked Chrome extension completes browser tasks created by the local TripBuddy app. It uses the user's normal Chrome session and never launches or copies a separate browser profile.

## Install

1. Open the Chrome profile used for travel checks.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select this `browser-extension` directory.
4. After extension source changes, press **Reload** on the extension card.

## Supported tasks

- **Booking price check:** open a task from a booking page. The companion follows only server-approved Hyatt navigation and stops after capturing a pre-payment price summary.
- **Official hotel search:** run a search from `/hotel-search`. The companion selects the profile's rendered currency, returns visible starting rates, and can safely follow a selected hotel's `View Rates` path to a pre-payment total with visible taxes and fees.
- **Hyatt account import:** start from the dashboard. The companion reads `My Stays`, collects visible `Stay Details` links, then opens each reservation detail URL directly.

The task ID and local endpoint live in the URL fragment and tab `sessionStorage`; Hyatt does not require them. The popup only retries the task already associated with the active tab. It does not accept an arbitrary booking ID or parse prices independently.

## Safety boundary

The companion may read visible text and navigate through room, rate-plan, cart, and pre-payment summary pages. It must never click payment, purchase, confirmation, complete-reservation, place-order, or submit-payment controls.

The server-side planner and content script execute the same shared rule module in `safetyRules.js`. Task fragment and session-storage keys come from the shared `taskProtocol.js`. The extension fails closed if either module is unavailable.

## Shared module boundary

The nested `package.json` is intentional and must not be removed as unused metadata. Its `"type": "commonjs"` declaration lets the classic Chrome content scripts and the Next.js server import the same `safetyRules.js` and `taskProtocol.js` files. Server code references this boundary through the `@extension/*` TypeScript path alias.
