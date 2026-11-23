import test from "node:test";
import assert from "node:assert/strict";
import { scoreBid, scoreAllBids, pickWinner, winnerReason, planQualityScore, makeTemplateBids, makeTemplateOutput, criticTotal, updateRating, validateTask, applyCharge, MODEL_FALLBACKS, BANNED_COPY } from "../src/engine.js";
import { PERSONAS, SEEDED_TASKS, SEEDED_OUTPUTS, START_BALANCE } from "../src/data.js";
import { readFileSync } from "node:fs";

const task = { title: "Find 10 AI startups hiring interns in India", description: "List startups and draft emails", budget: 100, category: "Research" };

test("rubric: cheaper bid scores higher on price", () => {
  const bids = [
    { personaId: "theo", price: 30, etaMinutes: 2, confidence: 0.7, plan: "Draft ten emails fast." },
    { personaId: "priya", price: 85, etaMinutes: 6, confidence: 0.8, plan: "Table of startups with roles and pay." },
  ];
  const s = scoreAllBids(bids, task);
  assert.ok(s[0].scores.price > s[1].scores.price);
  assert.ok(s[0].scores.speed > s[1].scores.speed);
  assert.equal(s[0].scores.rating, Math.round((4.4 / 5) * 100));
});

test("rubric: total is the weighted sum and within 0..100", () => {
  const bids = SEEDED_TASKS[0].bids;
  const scored = scoreAllBids(bids, task);
  for (const b of scored) {
    const expect = Math.round(b.scores.price * 0.25 + b.scores.speed * 0.2 + b.scores.plan * 0.4 + b.scores.rating * 0.15);
    assert.equal(b.scores.total, expect);
    assert.ok(b.scores.total >= 0 && b.scores.total <= 100);
  }
});

test("rubric: plan quality rewards task words and concrete steps", () => {
  const good = planQualityScore("Search hiring pages for AI startups in India, keep only open intern roles, then draft one cold email per startup.", task.title, task.description);
  const bad = planQualityScore("Do the thing.", task.title, task.description);
  assert.ok(good > bad, `good=${good} bad=${bad}`);
  assert.ok(good >= 50);
});

test("winner: highest total wins; tie breaks on lower price", () => {
  const bids = scoreAllBids(SEEDED_TASKS[0].bids, task);
  const w = pickWinner(bids);
  assert.ok(w);
  assert.equal(w.scores.total, Math.max(...bids.map((b) => b.scores.total)));
  // tie-break: identical scores, cheaper wins
  const tied = [
    { personaId: "theo", price: 30, etaMinutes: 2, confidence: 0.7, plan: "x", scores: { total: 80, price: 70, speed: 90, plan: 80, rating: 88 } },
    { personaId: "mara", price: 60, etaMinutes: 2, confidence: 0.7, plan: "x", scores: { total: 80, price: 40, speed: 90, plan: 80, rating: 92 } },
  ];
  assert.equal(pickWinner(tied).personaId, "theo");
  assert.equal(pickWinner([]), null);
});

test("winner reason names the persona and the total", () => {
  const bids = scoreAllBids(SEEDED_TASKS[0].bids, task);
  const reason = winnerReason(pickWinner(bids), task);
  assert.match(reason, /wins:/);
  assert.match(reason, /\/100/);
});

test("seeded tasks: rubric winner matches the pre-generated output's winner", () => {
  for (const t of SEEDED_TASKS) {
    const scored = scoreAllBids(t.bids, t);
    assert.equal(pickWinner(scored).personaId, SEEDED_OUTPUTS[t.id].winnerId, t.id);
  }
});

test("seeded tasks: five distinct bids each, all personas covered, prices within budget", () => {
  for (const t of SEEDED_TASKS) {
    assert.equal(t.bids.length, 5);
    assert.deepEqual([...new Set(t.bids.map((b) => b.personaId))].sort(), PERSONAS.map((p) => p.id).sort());
    for (const b of t.bids) assert.ok(b.price > 0 && b.price <= t.budget, `${t.id} ${b.personaId} price ${b.price}`);
    assert.ok(bidsDiffer(t.bids), `${t.id} bids must differ on price and ETA`);
  }
  function bidsDiffer(bids) {
    return new Set(bids.map((b) => b.price)).size > 1 && new Set(bids.map((b) => b.etaMinutes)).size > 1;
  }
});

test("seeded outputs exist for every seeded task and name the winner", () => {
  for (const t of SEEDED_TASKS) {
    const out = SEEDED_OUTPUTS[t.id];
    assert.ok(out, t.id);
    assert.ok(out.body.length > 200, t.id);
    assert.ok(out.steps.length >= 3);
    assert.ok(out.review.accuracy >= 1 && out.review.accuracy <= 5);
    assert.ok(t.bids.some((b) => b.personaId === out.winnerId));
  }
  // startups output really lists ten companies
  assert.match(SEEDED_OUTPUTS["seed-startups"].body, /10\. /);
  // code output is Python with the required behaviours
  assert.match(SEEDED_OUTPUTS["seed-csv-script"].body, /def clean_row/);
  assert.match(SEEDED_OUTPUTS["seed-csv-script"].body, /Duplicate emails skipped/);
});

test("template bids are deterministic for the same task", () => {
  const a = makeTemplateBids(task);
  const b = makeTemplateBids(task);
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.ok(new Set(a.map((x) => x.price)).size > 1);
  const other = makeTemplateBids({ ...task, title: "Write a birthday speech for my grandmother" });
  assert.notDeepEqual(a, other);
});

test("template output is labelled a template and never claims to be real work", () => {
  const bids = scoreAllBids(makeTemplateBids(task), task);
  const out = makeTemplateOutput(task, pickWinner(bids));
  assert.match(out.body, /template output/i);
  assert.match(out.body, /not a finished result/);
});

test("critic total and rating update are correct", () => {
  assert.equal(criticTotal({ accuracy: 4, completeness: 5, usefulness: 4 }), 87);
  assert.equal(criticTotal({ accuracy: 5, completeness: 5, usefulness: 5 }), 100);
  const p = { rating: 4.6, jobs: 18 };
  const u = updateRating(p, 4.3);
  assert.equal(u.jobs, 19);
  assert.equal(u.rating, 4.6); // (4.6*18 + 4.3)/19 = 4.584 -> 4.6
  const u2 = updateRating({ rating: 4.0, jobs: 1 }, 5);
  assert.equal(u2.rating, 4.5);
});

test("task validation catches short titles, low budgets, and overspend", () => {
  assert.ok(validateTask({ title: "Hi", budget: 100 }, 1000).length > 0);
  assert.ok(validateTask({ title: "A proper task title here", budget: 5 }, 1000).length > 0);
  assert.ok(validateTask({ title: "A proper task title here", budget: 600 }, 1000).length > 0);
  assert.ok(validateTask({ title: "A proper task title here", budget: 200 }, 100).length > 0);
  assert.deepEqual(validateTask({ title: "A proper task title here", budget: 100 }, 1000), []);
});

test("ledger maths: charge subtracts exactly", () => {
  assert.equal(applyCharge(1000, 60), 940);
  assert.equal(applyCharge(START_BALANCE, 0), 1000);
});

test("model fallbacks start with the verified current model", () => {
  assert.equal(MODEL_FALLBACKS[0], "gemini-3.5-flash");
  assert.ok(MODEL_FALLBACKS.includes("gemini-2.5-flash"));
});

test("no banned cliché copy in the app's visible text", () => {
  const files = ["index.html", "src/app.js", "src/data.js", "README.md", "PLAN.md"];
  for (const f of files) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8").toLowerCase();
    for (const word of BANNED_COPY) {
      const hits = text.split(word).length - 1;
      assert.ok(hits === 0, `${f} contains banned copy word "${word}"`);
    }
  }
});

test("personas: five bidders with distinct roles, temperatures, and ratings", () => {
  assert.equal(PERSONAS.length, 5);
  assert.equal(new Set(PERSONAS.map((p) => p.role)).size, 5);
  assert.equal(new Set(PERSONAS.map((p) => p.temperature)).size, 5);
  for (const p of PERSONAS) assert.ok(p.rating >= 1 && p.rating <= 5 && p.jobs > 0);
});
