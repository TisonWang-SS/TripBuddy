# TripBuddy

TripBuddy is a local-first hotel booking optimization workspace. It imports visible hotel evidence from the user's normal Chrome session, calculates comparable costs, and explains whether an existing booking should be kept or reviewed.

TripBuddy never books, cancels, pays for, confirms, or modifies a reservation. Every booking change remains a user action on the hotel website.

## Requirements

- Node.js 20 or newer
- npm
- Google Chrome for browser-backed Hyatt workflows

## Local setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev -- --hostname 0.0.0.0
```

Open [http://localhost:3000](http://localhost:3000). The SQLite database is stored locally at `data/tripbuddy.db` by default.

## Browser Companion

Hyatt searches, booking price checks, and account imports use the unpacked Chrome extension in [`browser-extension/`](browser-extension/README.md). It operates in the user's normal Chrome profile and only performs navigation approved by TripBuddy's deterministic safety rules.

## Validation

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Documentation

- [Product requirements](docs/PRD.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [System design and AI-agent interview guide](docs/SYSTEM_DESIGN_AND_AI_AGENT_INTERVIEW_GUIDE.zh-CN.md)
- [Code review report](docs/CODE_REVIEW.zh-CN.md)
