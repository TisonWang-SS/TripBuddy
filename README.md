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

### The agent loop

The conversation on `/` is the product's front door. The model gathers what you need, calls capabilities as tools, reads what came back, and advises on it — repeating until it can conclude or needs something only you can supply.

It writes the reasoning; the product writes the numbers. A recommendation points at a row and the price beside it is read from stored data, and a money-sized figure in its prose must be one the tools produced. Every capability that opens a Hyatt tab waits for your press first. See [ADR 0005](docs/decisions/0005-model-writes-advice.md).

With no API key the loop does not run: keyword routing picks one capability over the same catalogue and product copy answers. Score both paths with `npm run eval:intent-router`; the deterministic router is the checked-in baseline that the model must match. See [ADR 0002](docs/decisions/0002-model-influenced-routing.md).

API references: [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion), [JSON Output](https://api-docs.deepseek.com/guides/json_mode/), and [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode).

## Browser Companion

Hyatt searches, booking price checks, and account imports use the unpacked Chrome extension in [`browser-extension/`](browser-extension/README.md). It operates in the user's normal Chrome profile and only performs navigation approved by TripBuddy's deterministic safety rules.

## RollingGo Global OTA comparison

When the Global hotel skill has an active login, Hyatt city searches also request room details from RollingGo Global for the visible hotels. TripBuddy stores the lowest available OTA room quote as a separate source and marks it as tax-inclusive; the source does not expose a fee breakdown, and the quote must be confirmed before booking. The adapter reads the skill's local token file at `~/.hotel-global-cli/token.json`; `ROLLINGGO_GLOBAL_TOKEN_PATH`, `ROLLINGGO_GLOBAL_MCP_BASE_URL`, `ROLLINGGO_GLOBAL_COUNTRY_CODE`, and `ROLLINGGO_GLOBAL_TIMEOUT_MS` can override the defaults for a deployed server.

## Validation

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Documentation

Each document owns one tense, so none of them has to be read against the others.

- [Current status](docs/STATUS.zh-CN.md) — what works today, what is verified, what is next. **Start here.**
- [Product requirements](docs/PRD.md) — what the product should be, and the rules each feature follows.
- [Decisions](docs/decisions/) — why it is built this way. Append-only.
- [System design and AI-agent interview guide](docs/SYSTEM_DESIGN_AND_AI_AGENT_INTERVIEW_GUIDE.zh-CN.md) — how the system works now.
- [Code review report](docs/CODE_REVIEW.zh-CN.md) — what was found and fixed, round by round. A historical record, not current state.
