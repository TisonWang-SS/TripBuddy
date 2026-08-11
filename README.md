# TripBuddy

TripBuddy is a local-first hotel booking optimization workspace. It imports visible hotel evidence from the user's normal Chrome session, calculates comparable costs, and explains whether an existing booking should be kept or reviewed.

TripBuddy never books, cancels, pays for, confirms, or modifies a reservation. Every booking change remains a user action on the hotel website.

## Requirements

- Node.js 20.6 or newer (`--env-file` is used by the opt-in LLM evaluator)
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

### Optional LLM evidence extraction

Completed price checks can replay their sanitized browser snapshots through a schema-constrained LLM extractor from the booking Logs page. Configure it in `.env`:

```bash
TRIPBUDDY_LLM_API_KEY="your-api-key"
TRIPBUDDY_LLM_BASE_URL="https://api.deepseek.com"
TRIPBUDDY_LLM_MODEL="deepseek-v4-flash"
```

The extractor uses DeepSeek's OpenAI-compatible Chat Completions endpoint with JSON Output. The API key is read only on the server. Browser capture remains deterministic; model proposals are persisted only after local schema, page-grounding, currency, and arithmetic checks.

After changing LLM configuration, run `npm run eval:llm-extractor:smoke` for one live fixture. Run the full opt-in shared-fixture comparison with `npm run eval:llm-extractor`; it compares against the checked-in deterministic baseline in `docs/evals/`. Both commands load `.env` explicitly.

API references: [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion), [JSON Output](https://api-docs.deepseek.com/guides/json_mode/), and [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode).

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
