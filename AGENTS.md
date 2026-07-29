# TripBuddy Agent Notes

## Browser Testing

- Hyatt browser work must use normal Chrome with the TripBuddy Browser Companion extension. Do not add an automated or copied-profile fallback.
- Browser-backed Hyatt tasks are initiated by TripBuddy, carried in URL fragments and tab session storage, and completed by posting visible evidence back to the local app.
- When validating Hyatt city search pricing, do not trust the `currency` URL parameter by itself. Hyatt can still render `Hotel Currency`; switch the page currency selector to the requested currency before scraping `Avg/Night` text.
- Product validation should go through the app API/page whenever possible, not only standalone scripts. For this repo, verify browser-backed Hyatt search through `/api/hyatt-city-search` and `/hotel-search`.
- Hyatt account booking import should first read `My Stays`, collect visible `Stay Details` links, then open those reservation-detail URLs directly. Do not loop by clicking one stay, returning to the summary page, and clicking the next stay.
- Hyatt reservation details can expose the current booking baseline as cash (`Total Cost Per Room* $614.48`), points (`22,500 points`), or an award certificate (`Total Awards** 1 Free Night`). Preserve all three forms.
- Treat already-started stays as non-active. Imported Hyatt stays should only update the active list when `checkIn` is today or later.
- Hyatt can intermittently expose an empty account DOM. Treat that as unreadable browser evidence and stop rather than writing partial or empty booking data.
- In the Codex sandbox, `npm run dev` can fail with `listen EPERM` even when the app is fine. Use an escalated dev-server command for local browser validation.
- If Next dev serves `500` with `TypeError: __webpack_modules__[moduleId] is not a function`, stop the dev server, delete `.next`, and restart. This is a broken dev-cache symptom, not necessarily an app bug.
- Clean generated files before committing browser-test work, especially `.next`, `tsconfig.tsbuildinfo`, and temporary inspection scripts.
