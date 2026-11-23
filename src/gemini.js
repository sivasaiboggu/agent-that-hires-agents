// Live Gemini calls (REST, v1beta). Used only when the user pastes their own
// free Gemini API key in Settings. Key is read from localStorage at call time
// and never stored anywhere else. Default model gemini-3.5-flash — verified
// 23 Nov 2026 as working on new free keys; 2.5 models 404 for new users.
import { MODEL_FALLBACKS } from "./engine.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callModel(model, apiKey, payload, signal) {
  const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  return res.json();
}

function textOf(data) {
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

/** Try models in order until one answers. Returns { model, text }. */
export async function generateWithFallback(apiKey, preferredModel, payload, signal) {
  const models = [preferredModel, ...MODEL_FALLBACKS.filter((m) => m !== preferredModel)];
  let lastError = null;
  for (const model of models) {
    try {
      const data = await callModel(model, apiKey, payload, signal);
      const text = textOf(data);
      if (!text.trim()) throw new Error("Empty reply from the model");
      return { model, text };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
    }
  }
  throw lastError || new Error("No model answered");
}

export async function testKey(apiKey, model) {
  const { model: used } = await generateWithFallback(apiKey, model, {
    contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 10 },
  });
  return used;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in the reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** One live bid from one persona. Throws on failure — caller falls back to cached. */
export async function liveBid(apiKey, model, persona, task, signal) {
  const prompt = [
    `You are ${persona.name}, a ${persona.role} bidding for a job on an agent marketplace.`,
    `Your approach: ${persona.approach}`,
    `Task: ${task.title}`,
    `Details: ${task.description || task.title}`,
    `Category: ${task.category}. Client budget: ${task.budget} credits.`,
    `Reply with JSON only, no other text: {"price": <integer credits, 10 to ${task.budget}>, "etaMinutes": <integer 1-15>, "confidence": <0.0-1.0>, "plan": "<2-3 sentences, concrete steps, mention the deliverable>"}.`,
    "Bid honestly for your role: a Writer should be cheap and fast with no sources; a Coder should be dearer and slower; an Analyst should promise a table.",
  ].join("\n");
  const { model: used, text } = await generateWithFallback(apiKey, model, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: persona.temperature, maxOutputTokens: 400 },
  }, signal);
  const bid = extractJson(text);
  return {
    personaId: persona.id,
    price: Math.max(10, Math.min(task.budget, Math.round(Number(bid.price) || 50))),
    etaMinutes: Math.max(1, Math.min(15, Math.round(Number(bid.etaMinutes) || 5))),
    confidence: Math.max(0.1, Math.min(1, Number(bid.confidence) || 0.7)),
    plan: String(bid.plan || "I will do the job as described.").slice(0, 400),
    source: "live",
    modelUsed: used,
  };
}

/** Live execution: stream the winner's deliverable. Falls back to non-streaming. */
export async function liveExecute(apiKey, model, persona, task, bid, onChunk, signal) {
  const prompt = [
    `You are ${persona.name}, a ${persona.role}. You won a job on an agent marketplace. Do the job now, in full.`,
    `Your approach: ${persona.approach}`,
    `Task: ${task.title}`,
    `Details: ${task.description || task.title}`,
    `Your winning bid promised: ${bid.plan}`,
    "Write the finished deliverable as plain text (markdown headings and lists are fine). No preamble about being an AI, no apology, no filler. If you list facts or companies, say plainly when a detail should be checked.",
  ].join("\n");
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: persona.temperature, maxOutputTokens: 4000 },
  };
  // Try streaming first; fall back to a single call.
  try {
    const res = await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal,
    });
    if (!res.ok) throw new Error(`stream ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          const chunk = textOf(JSON.parse(t.slice(5)));
          if (chunk) { full += chunk; onChunk(full); }
        } catch { /* partial JSON line — ignore */ }
      }
    }
    if (full.trim()) return { text: full, modelUsed: model };
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  const { model: used, text } = await generateWithFallback(apiKey, model, payload, signal);
  onChunk(text);
  return { text, modelUsed: used };
}

/** Live critic review of delivered work. */
export async function liveReview(apiKey, model, task, deliverable, signal) {
  const prompt = [
    "You are June, a critic who scores delivered work. Be fair and plain.",
    `Task: ${task.title}`,
    `Delivered work:\n${deliverable.slice(0, 6000)}`,
    'Reply with JSON only: {"accuracy": 1-5, "completeness": 1-5, "usefulness": 1-5, "note": "<one sentence on what to fix, if anything>"}',
  ].join("\n");
  const { text } = await generateWithFallback(apiKey, model, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
  }, signal);
  const r = extractJson(text);
  return {
    accuracy: Math.max(1, Math.min(5, Math.round(Number(r.accuracy) || 3))),
    completeness: Math.max(1, Math.min(5, Math.round(Number(r.completeness) || 3))),
    usefulness: Math.max(1, Math.min(5, Math.round(Number(r.usefulness) || 3))),
    note: String(r.note || "Solid work.").slice(0, 300),
  };
}
