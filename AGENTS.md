# TripBuddy Agent Notes

## Browser Testing

- Hyatt blocks empty, headless, or fresh CDP profiles. Do not validate Hyatt flows with an empty `--user-data-dir`; it can return `ERROR:E6020` or a generic Hyatt error page.
- For Hyatt browser work, use a real Chrome profile with remote debugging. This project has used a copied real profile at `data/chrome-hyatt-profile` with `--profile-directory=Profile 7` and CDP port `9222`.
- Chrome may refuse remote debugging against the default user data directory. If CDP does not attach to the normal Chrome profile, copy the intended profile into a project-local data directory and launch Chrome with `--remote-debugging-port=9222 --user-data-dir=<copied-dir> --profile-directory=<profile-dir>`.
- When validating Hyatt city search pricing, do not trust the `currency` URL parameter by itself. Hyatt can still render `Hotel Currency`; switch the page currency selector to the requested currency before scraping `Avg/Night` text.
- Product validation should go through the app API/page whenever possible, not only standalone scripts. For this repo, verify browser-backed Hyatt search through `/api/hyatt-city-search` and `/hotel-search`.
- Hyatt account booking import should first read `My Stays`, collect visible `Stay Details` links, then open those reservation-detail URLs directly. Do not loop by clicking one stay, returning to the summary page, and clicking the next stay.
- Hyatt reservation details can expose the current booking baseline as cash (`Total Cost Per Room* $614.48`), points (`22,500 points`), or an award certificate (`Total Awards** 1 Free Night`). Preserve all three forms.
- Treat already-started stays as non-active. Imported Hyatt stays should only update the active list when `checkIn` is today or later.
- Hyatt can intermittently expose an empty account DOM to CDP. Treat that as unreadable browser evidence and stop rather than writing partial or empty booking data.
- In the Codex sandbox, `npm run dev` can fail with `listen EPERM` even when the app is fine. Use an escalated dev-server command for local browser validation.
- If Next dev serves `500` with `TypeError: __webpack_modules__[moduleId] is not a function`, stop the dev server, delete `.next`, and restart. This is a broken dev-cache symptom, not necessarily an app bug.
- Clean generated files before committing browser-test work, especially `.next`, `tsconfig.tsbuildinfo`, and temporary CDP inspection scripts.
