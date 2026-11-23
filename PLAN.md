# HireAgents — PLAN.md

## 1. What it is (one sentence)
Post a task once, and five specialist agent personas bid on price, speed, and plan; a visible rubric picks the winner, the winner does the work, and a critic scores it — all in one board.

## 2. Honesty statement (on screen, in the app, in the README)
There is no real marketplace of independent agents here. Every persona is a
different system prompt, tool set, temperature, and price profile calling the
**same Gemini model** underneath. The product is the auction: the bidding,
the transparent rubric, and the visible quality difference between personas.
- With no API key: the auction runs end to end on **cached bids** — hand-tuned
  bid sets for three seeded tasks, and deterministic template bids for any
  custom task. Every cached bid is labelled "Cached bid".
- With a free Gemini API key (pasted in Settings, localStorage only, never
  sent anywhere else): bids and the winner's work are generated live by the
  model. Live bids are labelled "Live bid". A live call that fails falls back
  to a cached bid and says so.
- Credits are fake. No real money moves. Ratings are earned inside this app
  only, from critic scores on completed tasks.

## 3. Who it is for
A founder, student, or small team who has a concrete job (research, writing,
code, analysis) and wants to compare approaches before committing — instead
of picking one agent blind and hoping.

## 4. Design identity
- **References (from the playbook):** Linear (dense, tabular, quiet board;
  the auction as a ledger, not a hero) and Upwork (marketplace bid cards with
  price, time, and history side by side). Mobbin for the mobile tab flow.
- **Signature idea:** the auction as a ledger — one ruled table where every
  bid is a row with its rubric maths visible, and the winner gets a thick
  indigo left rule. No hero, no marketing section.
- **Colour:** indigo ink `#312E81` as the single accent, warm paper
  `#FAF9F6`, ink text `#1C1B1F`, hairline borders `#E5E3DE`. No gradients,
  no glows.
- **Type:** Outfit (Google Fonts, OFL) for everything; system monospace for
  credit figures and timers (tabular numerals throughout).
- **Copy:** plain human words. "Post a task." "Five bids. One rubric."
  No cliché marketing adjectives in headlines.

## 5. Stack (verified 23 Nov 2026)
- **Frontend only — no backend, no build step.** Plain HTML + CSS + ES
  modules, served as static files (GitHub Pages-ready). This is a deliberate
  choice: the whole auction, rubric, ledger, and persistence run client-side,
  so the demo never depends on a server or a cold start.
- **Persistence:** localStorage (`hireagents.v1`) — tasks, bids, ledger,
  ratings, settings. Export/import JSON backup. Reset button.
- **Live model:** Google Gemini REST API (`generativelanguage.googleapis.com`,
  `v1beta`, `generateContent` / `streamGenerateContent?alt=sse`). Default
  model **`gemini-3.5-flash`**; fallback order `gemini-3.6-flash`,
  `gemini-2.5-flash`. Reason: web search on 23 Nov 2026 shows Gemini 2.5
  models return 404 "no longer available to new users" for new keys, and
  `gemini-3.5-flash` / `gemini-3.6-flash` answer on new free keys. The model
  is a setting, not hardcoded in one place, so the next retirement is a
  one-line change. Persona temperatures differ (Analyst 0.2, Researcher 0.4,
  Coder 0.3, Writer 0.9, Planner 0.7) so live bids genuinely differ.
- **No live web search in this build.** The Researcher persona's live
  execution is model-generated with named sources from its knowledge and is
  labelled as such; a browser client cannot call DuckDuckGo without a proxy.
  (v2: a small proxy endpoint for real search.)
- **No sandboxed code execution in this build.** The Coder persona delivers
  code as text with a copy/download button; the app checks JavaScript syntax
  locally where applicable and says so. (v2: a sandboxed runner.)
- **Tests:** Node's built-in runner (`node --test`), no dependencies.
- **Screenshots:** headless Chromium via `/opt/meta-chromium/chrome`,
  `file://` URLs, 1280px desktop + 390px mobile.

## 6. Personas (5 bidders + 1 critic)
| Persona | Role | Tools (in this build) | Temp | Starting rating | Price style |
|---|---|---|---|---|---|
| Mara — Researcher | Finds facts, lists sources | Model-generated research brief | 0.4 | 4.6 (18 jobs) | Mid, cites sources |
| Theo — Writer | Drafts, rewrites, emails | Drafting only, no sources | 0.9 | 4.4 (22 jobs) | Cheap, fast |
| Dev — Coder | Writes and explains code | Code output + local syntax check | 0.3 | 4.7 (15 jobs) | Dear, precise |
| Priya — Analyst | Tables, numbers, comparisons | Structured tables / CSV download | 0.2 | 4.8 (12 jobs) | Dear, careful |
| Sam — Planner | Breaks work into steps, owns delivery | Step plan + checklist output | 0.7 | 4.3 (20 jobs) | Mid, steady |
| June — Critic (does not bid) | Scores delivered work 1–5 on accuracy, completeness, usefulness; writes one plain sentence of what to fix | — | 0.2 | — | — |

Each persona card shows: role, one-line approach, tools, jobs done, rating,
average price, average delivery time. Ratings change only when June scores a
real completed task in this app.

## 7. Data model (localStorage)
```
settings   { apiKey: string|null, model: string, balance: number }
personas   { id, name, role, approach, tools[], temperature, jobs, rating, avgPrice, avgMinutes }
tasks      { id, title, description, category, budget, createdAt, status: open|auction|awarded|done|cancelled, winnerId|null, source: seeded|custom }
bids       { id, taskId, personaId, price, etaMinutes, confidence (0-1), plan: string, deliverable: string, source: cached|live|template, scores: {price, speed, plan, rating, total}, createdAt }
ledger     { id, at, kind: grant|charge|refund, amount, note, balanceAfter }
reviews    { id, taskId, personaId, accuracy, completeness, usefulness, score, note, at }
```
Seeded on first run: balance 1,000 credits (a "grant" ledger entry), the six
personas above, three seeded tasks with hand-tuned bids and pre-generated
winner outputs.

## 8. Feature set (SaaS level, still demoable in 24–48h)
1. **Post a task** — title, description, category (Research / Writing /
   Code / Analysis / Planning), budget in credits (10–500), required skills
   (checkboxes, optional). Validation: title ≥ 8 chars, budget within
   balance. Posting starts the auction immediately.
2. **Live auction board** — 60-second countdown; bids arrive staggered
   (one every ~4s in cached mode, as live calls return in live mode).
   Each bid card: persona, price, ETA, confidence, 2–3 line plan, source
   label (Cached / Live / Template), and the rubric breakdown.
3. **Transparent rubric** — Price 25%, Speed 20%, Plan quality 40%, Past
   rating 15%. Plan quality carries the most weight on purpose: the point
   of the auction is the quality difference between personas, not just who
   is cheapest. Every component score is shown per bid with the formula in
   plain words next to it. Price score = cheaper vs budget; Speed =
   faster vs the slowest bid; Plan = length + concrete steps + task
   keywords matched; Rating = persona rating / 5. Winner = highest total;
   ties break on lower price, then higher rating.
4. **Hire the winner** — the top bid is highlighted with the reason in one
   sentence ("Cheapest plan that covers all 10 companies, 4.8 rating").
   Hiring charges the price from the balance and moves the task to
   "In progress". The user can also hire any other bid manually (with the
   rubric difference shown).
5. **Winner executes** — the deliverable appears progressively (streamed
   from Gemini in live mode; revealed in chunks in cached mode, labelled as
   a replay of the pre-generated output). Copy + download (.md / .csv for
   Analyst) buttons. A progress line says what step the winner is on.
6. **Critic review** — June scores accuracy / completeness / usefulness
   (1–5 each), total score, and one sentence of what to fix. The persona's
   rating and jobs-done update. The user can accept the work or ask for one
   revision (revision re-runs the winner once, in live mode a fresh model
   call; in cached mode the stored alternate draft).
7. **Credit ledger** — opening grant, every charge/refund, running balance,
   low-balance warning under 100 credits. "Top up (demo)" adds 500 fake
   credits and logs it.
8. **Task history** — every task with status, winner, price paid, critic
   score; filter by status/category; reopen a completed task to read its
   deliverable.
9. **Agents roster** — all personas with stats, approach, and a per-persona
   job history drawn from completed tasks.
10. **Settings** — Gemini API key (password field, localStorage only,
    "Test key" button that makes one tiny model call), model picker, clear
    all data, export/import JSON.
11. **Seeded demo tasks** (one click each from the board):
    - "Find 10 AI startups hiring interns in India and draft a cold email for each" — budget 100.
    - "Compare pricing of 5 competitor tools into one table" — budget 80.
    - "Write a Python script that cleans a CSV of leads and flags duplicates" — budget 120.

## 9. Complete user flow, end to end
1. Land on the board. The honesty note sits under the title; balance
   (1,000 credits) is top right; three seeded tasks are listed.
2. Click a seeded task (or post your own in the form). Status becomes
   "Auction open", 60-second timer starts.
3. Bids arrive one by one. Each card shows price, ETA, confidence, plan,
   source label, and rubric scores as they are computed. The leaderboard
   re-sorts live.
4. Timer ends (or "End auction now"). The winner is highlighted with the
   one-sentence reason. The user clicks "Hire Mara — 60 credits" (or picks
   another bid).
5. Balance drops; ledger gains a charge entry; the work panel opens and the
   deliverable appears progressively with step labels ("Reading brief…",
   "Drafting…", "Checking the list…").
6. June's review appears: three sub-scores, total, one fix sentence.
   Persona rating updates on the roster.
7. User clicks "Accept work" (task → Done) or "Ask for one revision".
   The task, bids, deliverable, and review stay in History, readable any
   time. Export JSON backs it all up.

## 10. Edge cases
- Budget below every bid: auction still runs; the board says plainly which
  bids fit the budget and the user can raise the budget or hire anyway if
  the balance covers it.
- Balance below the winning price: Hire is disabled with the exact shortfall
  shown and a "Top up (demo)" button next to it.
- No API key: everything works on cached/template bids; the Settings page
  says live mode is off and nothing is faked as live.
- Key present but a live call fails (quota, 404 model, network): that bid
  falls back to cached, labelled "Cached (live call failed)", and the error
  is shown in plain words on the bid card.
- Empty history / empty ledger: the panel says what to do next, not "No data".
- Duplicate task titles: allowed; tasks are identified by id and time.

## 11. 2-minute demo script
- **0:00–0:20 — Post the task.** "One task, five agents, one rubric."
  Click the seeded task: "Find 10 AI startups hiring interns in India and
  draft a cold email for each." Budget 100 credits.
- **0:20–0:55 — The auction.** Bids arrive one by one. Narrate the spread:
  "Theo bids 30, fast, but no sources. Mara bids 60, three minutes, cites
  live sources. Priya bids 85 — careful, but dear." Point at the rubric
  numbers on each card.
- **0:55–1:30 — The winner works.** Hire Mara. The deliverable streams in:
  ten startups with a one-line cold email each. Point at the ledger: balance
  dropped by exactly 60.
- **1:30–1:50 — The review.** June scores it: accuracy 4, completeness 5,
  usefulness 4. Mara's rating moves from 4.6 to 4.6 (one more job counted).
  Show the roster update.
- **1:50–2:00 — Close.** "One model, five personas, a real auction with a
  visible rubric. No key needed for the demo; paste a free Gemini key in
  Settings and the same auction runs live."

## 12. Launch checklist
- [ ] Tests pass, 0 failures; screenshots read at 1280px + 390px, no overflow
- [ ] Seeded auction runs end to end with no key; live auction runs with a key
- [ ] Every bid labelled Cached / Live / Template; honesty note on screen
- [ ] Ledger maths correct (balance after every charge = previous − price)
- [ ] README + MIT LICENSE; git init + human commits; no push (repo to be created by Siva: `agent-that-hires-agents`)

## 13. v2 ideas
Real web search via a small proxy; sandboxed code runner for the Coder;
multi-round auctions (personas can lower their price once); escrow with
milestones; team workspaces and shared credit pools; saved task templates;
export deliverable to Google Docs; per-persona cost tracking against the
real Gemini bill.
