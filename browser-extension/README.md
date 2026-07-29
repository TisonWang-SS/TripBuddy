# TripBuddy Browser Companion

This unpacked Chrome extension imports visible hotel rate evidence from the user's real Chrome profile into the local TripBuddy app.

## Install

1. Open the Chrome profile used for travel checks.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Choose `Load unpacked`.
5. Select the `browser-extension` directory from this repository.

## Automatic Import

1. Run the local TripBuddy app at `http://localhost:3000`.
2. Open a TripBuddy booking detail page.
3. Click `Chrome import`.
4. Wait for the hotel page to render. The extension first tries to select a safe visible rate and wait for a price summary. If a final total appears, it imports that final total instead of the room-list nightly estimate.

The automatic link passes the booking ID in the URL hash, so it is not sent to the hotel server.
The extension stores the booking ID in tab session storage so the import can continue across Hyatt room, rate-plan, and pre-payment summary navigations.
The extension must not click final payment, confirmation, purchase, or submit controls.

## Hyatt Search And Account Tasks

- Hotel Search opens Hyatt in normal Chrome. The extension reads the visible city-search results and returns them to the waiting TripBuddy page.
- Import Hyatt bookings opens `My Stays`, collects visible `Stay Details` links, visits each detail in the same tab, and sends the accumulated snapshots to TripBuddy.
- These tasks use short-lived IDs in the URL fragment and tab session storage. They do not require a debugging port or a separate automated Chrome profile.

## Manual Import

1. Run the local TripBuddy app at `http://localhost:3000`.
2. Open a TripBuddy booking detail page and click `Chrome import`.
3. Click the TripBuddy extension icon on the opened hotel page.
4. Confirm the booking ID was filled automatically and click `Import current page`.

The extension only reads the active tab when the user clicks the import button. It does not book, cancel, pay, or submit hotel forms.
