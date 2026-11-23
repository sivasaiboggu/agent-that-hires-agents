// Pure logic for HireAgents: rubric scoring, winner selection, template bids,
// critic scoring, ledger maths. No DOM, no network — fully unit-tested.
import { PERSONAS } from "./data.js";

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function words(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

/** Plan quality 0..100: concrete steps + deliverables named + task words matched. */
export function planQualityScore(plan, taskTitle, taskDescription = "") {
  const p = (plan || "").toLowerCase();
  const taskWords = [...new Set([...words(taskTitle), ...words(taskDescription)])];
  const matched = taskWords.filter((w) => p.includes(w)).length;
  const keywordPart = taskWords.length ? (matched / taskWords.length) * 40 : 20;
  const stepPart = Math.min(30, (p.split(/[.;,]/).filter((s) => s.trim().length > 8).length) * 10);
  const lengthPart = Math.min(30, Math.max(0, p.length - 40) / 4);
  return Math.round(Math.min(100, keywordPart + stepPart + lengthPart));
}

/**
 * Score one bid 0..100 with a visible breakdown.
 * price 25% — cheaper vs budget; speed 20% — faster vs slowest bid;
 * plan 40% — planQualityScore; rating 15% — persona rating / 5.
 * Plan quality carries the most weight: the point of the auction is the
 * quality difference between personas, not just who is cheapest.
 */
export function scoreBid(bid, task, allBids) {
  const persona = PERSONAS.find((p) => p.id === bid.personaId) || { rating: 4 };
  const budget = Math.max(1, task.budget || 100);
  const price = Math.max(0, Math.min(100, Math.round((1 - Math.min(1, bid.price / budget)) * 100)));
  const slowest = Math.max(...allBids.map((b) => b.etaMinutes), 1);
  const speed = slowest <= 1 ? 100 : Math.round((1 - (bid.etaMinutes - 1) / slowest) * 100);
  const plan = planQualityScore(bid.plan, task.title, task.description);
  const rating = Math.round((persona.rating / 5) * 100);
  const total = Math.round(price * 0.25 + speed * 0.2 + plan * 0.4 + rating * 0.15);
  return { price, speed, plan, rating, total };
}

export function scoreAllBids(bids, task) {
  return bids.map((b) => ({ ...b, scores: scoreBid(b, task, bids) }));
}

/** Highest total wins; ties break on lower price, then higher rating. */
export function pickWinner(scoredBids) {
  if (!scoredBids.length) return null;
  return [...scoredBids].sort((a, b) => {
    if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total;
    if (a.price !== b.price) return a.price - b.price;
    const ra = (PERSONAS.find((p) => p.id === a.personaId) || {}).rating || 0;
    const rb = (PERSONAS.find((p) => p.id === b.personaId) || {}).rating || 0;
    return rb - ra;
  })[0];
}

export function winnerReason(bid, task) {
  const persona = PERSONAS.find((p) => p.id === bid.personaId);
  const parts = [];
  if (bid.scores.price >= 60) parts.push(`priced at ${bid.price} credits against a ${task.budget} budget`);
  if (bid.scores.speed >= 70) parts.push(`delivers in ${bid.etaMinutes} minutes`);
  if (bid.scores.plan >= 60) parts.push("its plan covers the job step by step");
  if (bid.scores.rating >= 90) parts.push(`a ${persona.rating} rating from finished jobs`);
  const why = parts.length ? parts.join(", ") : "the best total rubric score";
  return `${persona.name} wins: ${why}. Total ${bid.scores.total}/100.`;
}

/** Deterministic template bids for a custom task — labelled "Template bid" in the UI. */
export function makeTemplateBids(task) {
  const base = hashString(task.title + "|" + task.category);
  const profiles = {
    mara: { priceF: 0.6, eta: 4, plan: (t) => `Research the brief first: gather the facts for "${t}", keep only what checks out, then write it up with a source note for each claim.` },
    theo: { priceF: 0.3, eta: 2, plan: (t) => `Draft "${t}" in plain words, fast. No sources and no tables — you check the facts before you use it.` },
    dev: { priceF: 0.9, eta: 7, plan: (t) => `Build "${t}" as working code with short comments, then check it reads clean and handles bad input without crashing.` },
    priya: { priceF: 0.85, eta: 6, plan: (t) => `Turn "${t}" into a table: every number in a row, every row checked, with a CSV you can share.` },
    sam: { priceF: 0.55, eta: 5, plan: (t) => `Break "${t}" into steps with a checklist, work through them in order, and hand over the finished job with the list ticked off.` },
  };
  return PERSONAS.map((p, i) => {
    const jitter = ((base >> (i * 3)) % 11) - 5; // -5..+5, deterministic
    const prof = profiles[p.id];
    const price = Math.max(10, Math.round(task.budget * prof.priceF) + jitter);
    return {
      personaId: p.id,
      price,
      etaMinutes: Math.max(1, prof.eta + (((base >> (i * 2)) % 3) - 1)),
      confidence: Math.round((0.6 + (((base >> i) % 30) / 100)) * 100) / 100,
      plan: prof.plan(task.title),
    };
  });
}

/** Template winner output for a custom task (labelled as a template in the UI). */
export function makeTemplateOutput(task, winner) {
  const persona = PERSONAS.find((p) => p.id === winner.personaId);
  return {
    steps: ["Reading your brief", `Working as ${persona.name} (${persona.role})`, "Checking the result", "Handing it over"],
    title: task.title,
    body: [
      `Delivered by ${persona.name} (${persona.role}) for: ${task.title}`,
      "",
      "This is a template output — it shows the shape of the work, not a finished result. With a Gemini API key in Settings, the winner writes the real deliverable here.",
      "",
      `1. What you asked for: ${task.description || task.title}`,
      `2. How ${persona.name} approached it: ${persona.approach}`,
      `3. Budget used: ${winner.price} credits of ${task.budget}. Delivery time: about ${winner.etaMinutes} minutes.`,
      "4. Next step: paste a free Gemini API key in Settings and run this task again for the real, model-written deliverable.",
    ].join("\n"),
    review: { accuracy: 3, completeness: 3, usefulness: 3, note: "Template output, not real work — it shows the format only. Run it live for a real score." },
    revision: "Revision: same template with the checklist ticked off and the headings tightened. Run it live for real work.",
  };
}

/** Critic total 0..100 from three 1..5 sub-scores. */
export function criticTotal(review) {
  return Math.round(((review.accuracy + review.completeness + review.usefulness) / 15) * 100);
}

/** New persona rating after one more scored job (running average, 1 decimal). */
export function updateRating(persona, reviewScoreOutOf5) {
  const total = persona.rating * persona.jobs + reviewScoreOutOf5;
  return { rating: Math.round((total / (persona.jobs + 1)) * 10) / 10, jobs: persona.jobs + 1 };
}

export function validateTask(task, balance) {
  const errors = [];
  if (!task.title || task.title.trim().length < 8) errors.push("Title needs at least 8 characters.");
  if (!task.budget || task.budget < 10) errors.push("Budget needs to be at least 10 credits.");
  if (task.budget > 500) errors.push("Budget is capped at 500 credits per task.");
  if (task.budget > balance) errors.push(`Budget of ${task.budget} is more than your balance of ${balance} credits.`);
  return errors;
}

export function applyCharge(balance, price) {
  return balance - price;
}

export const MODEL_FALLBACKS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-2.5-flash"];

export const BANNED_COPY = ["seamless", "supercharge", "elevate", "unlock", "revolutionize", "AI-powered"];
