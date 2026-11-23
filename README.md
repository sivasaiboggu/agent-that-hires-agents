# HireAgents

Post a task once. Five specialist agent personas bid on price, speed, and plan. A visible rubric picks the winner, the winner does the work, and a critic scores it.

## The honest bit

There is no real marketplace of independent agents here. Every persona is a different set of instructions, tools, temperature, and price profile calling the **same Gemini model** underneath. The product is the auction: the bidding, the transparent rubric, and the visible difference between personas. The app says this on screen, and every bid is labelled **Cached**, **Live**, or **Template** so you always know which is which.

- **No API key:** the auction runs end to end on cached bids — hand-tuned bid sets for three seeded tasks, and deterministic template bids for any task you post. The winner's output is a pre-generated deliverable, revealed as a replay.
- **With a free Gemini API key** (Settings, stored in localStorage only): bids and the winner's work are generated live by the model, streamed into the work panel. A live call that fails falls back to a cached bid and says so on the card.
- **Credits are fake.** No real money moves. Ratings are earned inside this app only, from critic scores on completed tasks.

## How it works

1. Post a task (title, description, category, budget in credits) or pick a seeded task.
2. Bids arrive one by one over a 60-second auction. Each card shows price, delivery time, confidence, plan, source label, and the rubric breakdown.
3. The rubric: **Price 25%, Speed 20%, Plan quality 40%, Past rating 15%.** The formula is printed next to the board. Highest total wins; ties break on lower price.
4. Hire the winner (or any other bid). The price is charged from your 1,000-credit opening grant and logged in the ledger.
5. The winner's deliverable appears in the work panel. June, the critic, scores accuracy, completeness, and usefulness (1–5 each) and writes one sentence on what to fix. The persona's rating updates.
6. Accept the work, or ask for one revision.

## Seeded tasks (one click each)

- Find 10 AI startups hiring interns in India and draft a cold email for each — budget 100.
- Compare pricing of 5 competitor tools into one table — budget 80.
- Write a Python script that cleans a CSV of leads and flags duplicates — budget 120.

## Personas

| Persona | Role | Temperature | Rating | Style |
|---|---|---|---|---|
| Mara | Researcher | 0.4 | 4.6 | Mid price, cites sources |
| Theo | Writer | 0.9 | 4.4 | Cheap, fast, no sources |
| Dev | Coder | 0.3 | 4.7 | Dear, precise |
| Priya | Analyst | 0.2 | 4.8 | Dear, careful, tables |
| Sam | Planner | 0.7 | 4.3 | Mid price, steady |
| June | Critic | 0.2 | — | Scores work, does not bid |

## Stack

Plain HTML + CSS + ES modules. No backend, no build step, no dependencies. State lives in localStorage (`hireagents.v1`) with JSON export/import. Live mode calls the Gemini REST API (`v1beta`, `generateContent` / `streamGenerateContent`).

**Model (verified 23 Nov 2026):** default `gemini-3.5-flash`, fallback `gemini-3.6-flash`, then `gemini-2.5-flash`. Gemini 2.5 models return 404 "no longer available to new users" for new free keys; `gemini-3.5-flash` answers on new free keys. The model is a setting, so the next retirement is a one-line change.

## Run it

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or open `index.html` directly. Tests and screenshots need Node and Chromium:

```bash
npm test            # node --test tests/*.test.js
npm run shots       # headless Chromium screenshots, 1280px + 390px
```

## Honest limits

- **No live web search.** The Researcher works from the model's knowledge in live mode and says so; a browser client cannot call DuckDuckGo without a proxy. Seeded startup details should be checked against the company's own hiring page before you send anything.
- **No sandboxed code execution.** The Coder delivers code as text with copy/download. The app does not run it.
- **Live mode needs your key and network.** Without either, everything still works on cached bids — nothing is faked as live.
- **Ratings and credits exist only in this browser.** Reset in Settings wipes them.

## Files

- `index.html`, `styles.css` — the app
- `src/data.js` — personas, seeded tasks, cached bids, pre-generated outputs
- `src/engine.js` — rubric, winner selection, template bids, critic maths (pure, tested)
- `src/gemini.js` — live Gemini calls with model fallback
- `src/app.js` — UI and auction flow
- `PLAN.md` — the deepened SaaS-level plan
- `tokens.json` — design tokens (indigo ink `#312E81`, Outfit)

## License

MIT — Sivasai Boggu, 2026.
