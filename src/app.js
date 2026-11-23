// HireAgents — client-side app. No backend, no key needed for the demo.
import { PERSONAS, CRITIC, RUBRIC, CATEGORIES, SEEDED_TASKS, SEEDED_OUTPUTS, START_BALANCE } from "./data.js";
import { scoreAllBids, pickWinner, winnerReason, makeTemplateBids, makeTemplateOutput, criticTotal, updateRating, validateTask } from "./engine.js";
import { liveBid, liveExecute, liveReview, testKey } from "./gemini.js";

const KEY = "hireagents.v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-IN");
const persona = (id) => PERSONAS.find((p) => p.id === id);

function defaultState() {
  return {
    settings: { apiKey: "", model: "gemini-3.5-flash" },
    balance: START_BALANCE,
    personas: JSON.parse(JSON.stringify(PERSONAS)),
    tasks: [],
    bids: {},        // taskId -> [bid]
    outputs: {},     // taskId -> {title, body, steps, review, revision, source}
    ledger: [{ id: "grant-1", at: new Date().toISOString(), kind: "grant", amount: START_BALANCE, note: "Opening grant — demo credits, no real money", balanceAfter: START_BALANCE }],
    reviews: [],
    tab: "board",
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!s.settings || !Array.isArray(s.ledger)) return defaultState();
    return s;
  } catch { return defaultState(); }
}
let state = load();
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let auction = null; // { taskId, timer, revealed, interval, countdown }
let execTimer = null;

function uid() { return "id-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
function timeOf(iso) { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
function liveMode() { return Boolean(state.settings.apiKey && state.settings.apiKey.trim().length > 10); }

// ---------- render ----------
function render() {
  $("#balance").textContent = fmt(state.balance) + " credits";
  $("#balanceNote").textContent = liveMode() ? "Live mode — Gemini key connected" : "Demo mode — cached bids, no key needed";
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const views = { board: renderBoard, agents: renderAgents, history: renderHistory, ledger: renderLedger, settings: renderSettings };
  (views[state.tab] || renderBoard)();
  save();
}

function honestyNote() {
  return `<p class="honesty">One model, five personas. Every agent here is a different set of instructions calling the same Gemini model — there is no marketplace of independent agents. Bids are labelled <strong>Cached</strong>, <strong>Live</strong>, or <strong>Template</strong> so you always know which is which. Credits are fake; no real money moves.</p>`;
}

function renderBoard() {
  const open = state.tasks.filter((t) => t.status === "auction" || t.status === "decided");
  const activeTask = open[0];
  $("#view").innerHTML = `
    <section class="intro">
      <h1>Post a task. Five agents bid. You hire the best bid.</h1>
      ${honestyNote()}
    </section>
    <div class="grid">
      <section class="card">
        <h2>Post a task</h2>
        <form id="taskForm">
          <label>Title<input name="title" required minlength="8" maxlength="140" placeholder="e.g. Find 10 AI startups hiring interns in India"></label>
          <label>What needs doing<textarea name="description" rows="3" maxlength="800" placeholder="One or two sentences. What should the finished work look like?"></textarea></label>
          <div class="row2">
            <label>Category<select name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></label>
            <label>Budget (credits)<input name="budget" type="number" min="10" max="500" value="100" required></label>
          </div>
          <p class="hint">Your balance: ${fmt(state.balance)} credits. Posting starts the auction right away.</p>
          <div id="formError" class="error" hidden></div>
          <button class="btn primary" type="submit">Post task and open the auction</button>
        </form>
        <h3 class="sub">Or start with a seeded task</h3>
        <div class="seeded">
          ${SEEDED_TASKS.map((t) => {
            const done = state.tasks.find((x) => x.id === t.id);
            return `<button class="seed" data-seed="${t.id}" ${done ? "disabled" : ""}>
              <span class="seed-title">${esc(t.title)}</span>
              <span class="seed-meta">${t.category} · Budget ${t.budget} credits${done ? " · already run" : ""}</span>
            </button>`;
          }).join("")}
        </div>
      </section>
      <section class="card" id="auctionPanel">
        ${activeTask ? auctionHtml(activeTask) : `<h2>Auction board</h2><p class="empty">No auction running. Post a task or pick a seeded one — bids arrive one by one, with the rubric maths on every card.</p>
        <h3 class="sub">How the rubric works</h3>
        <ul class="rubric">${RUBRIC.map((r) => `<li><strong>${r.label} — ${r.weight}%.</strong> ${r.help}</li>`).join("")}</ul>`}
      </section>
    </div>
    <section class="card work" id="workPanel">${workHtml()}</section>`;
  wireBoard();
}

function auctionHtml(task) {
  const bids = (state.bids[task.id] || []).filter((b) => b.revealed !== false);
  const scored = bids.length ? scoreAllBids(bids, task) : [];
  const winner = task.status === "decided" || task.status === "awarded" || task.status === "done" ? pickWinner(scored) : null;
  const remaining = auction && auction.taskId === task.id ? auction.secondsLeft : 0;
  return `
    <div class="auction-head">
      <div><h2>${esc(task.title)}</h2>
      <p class="meta">${task.category} · Budget ${task.budget} credits · Posted ${timeOf(task.createdAt)} · ${liveMode() ? "Live auction" : "Cached auction"}</p></div>
      ${task.status === "auction" ? `<div class="timer"><span class="timer-num">${remaining}s</span><span class="timer-label">left in auction</span></div>` : ""}
    </div>
    ${task.status === "auction" ? `<div class="auction-actions"><button class="btn" id="endAuction">End auction now</button><span class="hint">Bids arrive one by one. The rubric scores each as it lands.</span></div>` : ""}
    <div class="bids">
      ${scored.length === 0 ? `<p class="empty">Waiting for the first bid…</p>` : scored.map((b) => bidCard(b, task, winner)).join("")}
    </div>
    ${winner && task.status === "decided" ? `<div class="winner-box">
      <p><strong>${esc(winnerReason(winner, task))}</strong></p>
      <div class="winner-actions">
        <button class="btn primary" id="hireWinner" ${state.balance < winner.price ? "disabled" : ""}>Hire ${esc(persona(winner.personaId).name)} — ${winner.price} credits</button>
        ${state.balance < winner.price ? `<span class="error">Short by ${fmt(winner.price - state.balance)} credits. <button class="linklike" id="topup1">Top up 500 demo credits</button></span>` : ""}
      </div>
      <p class="hint">Or hire any other bid below — the rubric difference is shown on each card.</p>
    </div>` : ""}
    ${task.status === "done" ? `<p class="done-note">Done. The deliverable and June's review are below, and in History.</p>` : ""}`;
}

function bidCard(b, task, winner) {
  const p = persona(b.personaId);
  const isWinner = winner && winner.personaId === b.personaId;
  const srcLabel = b.source === "live" ? "Live bid" : b.source === "template" ? "Template bid" : "Cached bid";
  const srcClass = b.source === "live" ? "src-live" : b.source === "template" ? "src-template" : "src-cached";
  return `<article class="bid ${isWinner ? "winner" : ""}">
    <div class="bid-top">
      <div><strong>${esc(p.name)}</strong> <span class="muted">· ${esc(p.role)} · ${p.rating}★ · ${p.jobs} jobs</span></div>
      <span class="src ${srcClass}">${srcLabel}${b.modelUsed ? " · " + esc(b.modelUsed) : ""}${b.fallbackNote ? " — " + esc(b.fallbackNote) : ""}</span>
    </div>
    <p class="bid-plan">${esc(b.plan)}</p>
    <div class="bid-nums">
      <span><strong>${b.price}</strong> credits</span>
      <span><strong>${b.etaMinutes} min</strong> delivery</span>
      <span>Confidence <strong>${Math.round(b.confidence * 100)}%</strong></span>
      <span class="total">Rubric <strong>${b.scores.total}/100</strong></span>
    </div>
    <div class="scores">${RUBRIC.map((r) => `<span title="${esc(r.help)}">${r.label} ${b.scores[r.key]} <i>(${r.weight}%)</i></span>`).join("")}</div>
    ${!isWinner && task.status === "auction" ? "" : ""}
    ${task.status === "awarded" || task.status === "done" ? "" : ""}
    ${task.status === "decided" && !isWinner ? `<button class="btn small hire-alt" data-hire="${b.personaId}" ${state.balance < b.price ? "disabled" : ""}>Hire ${esc(p.name)} instead — ${b.price} credits</button>` : ""}
  </article>`;
}

function workHtml() {
  const task = state.tasks.find((t) => t.status === "awarded" || t.status === "done");
  if (!task) return `<h2>Work in progress</h2><p class="empty">Nothing hired yet. When you hire a bid, the winner's work appears here.</p>`;
  const out = state.outputs[task.id];
  const p = task.winnerId ? persona(task.winnerId) : null;
  const review = state.reviews.find((r) => r.taskId === task.id);
  return `<h2>Work: ${esc(task.title)}</h2>
    <p class="meta">${p ? `Hired ${esc(p.name)} (${esc(p.role)})` : ""} · Paid ${task.paidPrice ?? ""} credits · ${task.status === "done" ? "Done" : "In progress"}</p>
    ${out ? `<p class="step-line" id="stepLine">${esc(out.currentStep || "Done")}</p>
    <pre class="output" id="outputText">${esc(out.visibleBody || "")}</pre>
    <div class="work-actions">
      <button class="btn" id="copyOut">Copy deliverable</button>
      <button class="btn" id="dlOut">Download .md</button>
      ${task.status === "awarded" ? `<button class="btn" id="askRevision">Ask for one revision</button>` : ""}
      ${task.status === "awarded" ? `<button class="btn primary" id="acceptWork">Accept work</button>` : ""}
    </div>` : `<p class="empty">The winner is starting…</p>`}
    ${review ? `<div class="review"><h3>June's review</h3>
      <p class="review-scores">Accuracy ${review.accuracy}/5 · Completeness ${review.completeness}/5 · Usefulness ${review.usefulness}/5 · <strong>Total ${criticTotal(review)}/100</strong></p>
      <p>${esc(review.note)}</p></div>` : ""}`;
}

function renderAgents() {
  $("#view").innerHTML = `<section class="intro"><h1>Agents</h1><p class="lede">Five personas, one model underneath. Ratings change only when June scores a finished job.</p></section>
  <div class="agents">${state.personas.map((p) => {
    const jobs = state.reviews.filter((r) => r.personaId === p.id);
    return `<article class="card agent">
      <div class="agent-top"><strong>${esc(p.name)}</strong><span class="rating">${p.rating}★ · ${p.jobs} jobs</span></div>
      <p class="role">${esc(p.role)}</p><p>${esc(p.approach)}</p>
      <p class="meta">Tools: ${p.tools.join(", ")} · Temperature ${p.temperature}</p>
      <p class="meta">Average price ${p.avgPrice} credits · Average delivery ${p.avgMinutes} min</p>
      ${jobs.length ? `<p class="meta">Scored jobs here: ${jobs.map((j) => `${criticTotal(j)}/100`).join(", ")}</p>` : `<p class="meta">No jobs scored in this app yet.</p>`}
    </article>`;
  }).join("")}
  <article class="card agent"><div class="agent-top"><strong>${esc(CRITIC.name)}</strong><span class="rating">Critic — does not bid</span></div>
  <p class="role">${esc(CRITIC.role)}</p><p>${esc(CRITIC.approach)}</p></article></div>`;
}

function renderHistory() {
  const tasks = [...state.tasks].reverse();
  $("#view").innerHTML = `<section class="intro"><h1>Task history</h1><p class="lede">Every task, bid, and review stays here.</p></section>
  ${tasks.length === 0 ? `<div class="card"><p class="empty">No tasks yet. Post one from the board.</p></div>` : tasks.map((t) => {
    const review = state.reviews.find((r) => r.taskId === t.id);
    const out = state.outputs[t.id];
    const w = t.winnerId ? persona(t.winnerId) : null;
    return `<article class="card history-item">
      <div class="hist-top"><strong>${esc(t.title)}</strong><span class="status ${t.status}">${t.status}</span></div>
      <p class="meta">${t.category} · Budget ${t.budget} · Posted ${timeOf(t.createdAt)}${w ? ` · Winner: ${esc(w.name)} (${t.paidPrice} credits)` : ""}${review ? ` · June: ${criticTotal(review)}/100` : ""}</p>
      ${out ? `<details><summary>Read the deliverable</summary><pre class="output">${esc(out.body)}</pre></details>` : ""}
    </article>`;
  }).join("")}`;
}

function renderLedger() {
  $("#view").innerHTML = `<section class="intro"><h1>Credit ledger</h1><p class="lede">Fake credits, real maths. Balance: <strong>${fmt(state.balance)}</strong>.</p></section>
  <div class="card"><p><button class="btn" id="topup2">Top up 500 demo credits</button> <span class="hint">Demo top-ups are logged, like everything else.</span></p>
  <table class="ledger"><thead><tr><th>When</th><th>What</th><th>Amount</th><th>Balance after</th></tr></thead><tbody>
  ${[...state.ledger].reverse().map((e) => `<tr><td>${timeOf(e.at)}</td><td>${esc(e.note)}</td><td class="${e.kind === "charge" ? "neg" : "pos"}">${e.kind === "charge" ? "−" : "+"}${fmt(e.amount)}</td><td>${fmt(e.balanceAfter)}</td></tr>`).join("")}
  </tbody></table></div>`;
  $("#topup2").onclick = () => topUp();
}

function renderSettings() {
  const s = state.settings;
  $("#view").innerHTML = `<section class="intro"><h1>Settings</h1><p class="lede">Your key stays in this browser only (localStorage). It is sent to Google's Gemini API and nowhere else.</p></section>
  <div class="grid"><section class="card">
    <h2>Gemini API key</h2>
    <p class="hint">Free key from Google AI Studio. Without one, the app runs on cached bids — nothing is faked as live. ${liveMode() ? "Live mode is on." : "Live mode is off."}</p>
    <label>API key<input id="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="Paste your free Gemini API key" autocomplete="off"></label>
    <label>Model<select id="modelSel">
      ${["gemini-3.5-flash", "gemini-3.6-flash", "gemini-2.5-flash"].map((m) => `<option ${s.model === m ? "selected" : ""}>${m}</option>`).join("")}
    </select></label>
    <p class="hint">Default gemini-3.5-flash: Gemini 2.5 models return 404 for new keys (checked 23 Nov 2026). If a model fails, the app tries the next one.</p>
    <div class="btn-row"><button class="btn primary" id="saveKey">Save key</button><button class="btn" id="testKeyBtn">Test key</button><button class="btn" id="clearKey">Remove key</button></div>
    <p id="keyMsg" class="hint"></p>
    <h3 class="sub">Your data</h3>
    <div class="btn-row"><button class="btn" id="exportBtn">Export JSON backup</button><button class="btn" id="resetBtn">Reset everything</button></div>
    <p class="hint">Reset clears tasks, bids, ledger, and ratings, and restores the 1,000-credit grant.</p>
  </section>
  <section class="card"><h2>What live mode changes</h2>
    <ul class="rubric"><li><strong>Bids:</strong> each persona writes its own bid through the model, with its own temperature.</li>
    <li><strong>Work:</strong> the winner writes the deliverable live, streamed into the work panel.</li>
    <li><strong>Review:</strong> June scores the real work through the model.</li>
    <li><strong>If a call fails:</strong> that bid falls back to cached and says so on the card.</li></ul>
    <p class="hint">No live web search in this build: the Researcher works from the model's knowledge and says so. No sandboxed code running either — the Coder delivers code as text.</p>
  </section></div>`;
  $("#saveKey").onclick = () => { state.settings.apiKey = $("#apiKey").value.trim(); state.settings.model = $("#modelSel").value; save(); $("#keyMsg").textContent = "Saved. Live mode is " + (liveMode() ? "on." : "off — add a key to turn it on."); render(); };
  $("#clearKey").onclick = () => { state.settings.apiKey = ""; save(); render(); };
  $("#testKeyBtn").onclick = async () => {
    const key = $("#apiKey").value.trim();
    if (!key) { $("#keyMsg").textContent = "Paste a key first."; return; }
    $("#keyMsg").textContent = "Testing…";
    try { const used = await testKey(key, $("#modelSel").value); $("#keyMsg").textContent = `Key works. Answered with ${used}.`; }
    catch (e) { $("#keyMsg").textContent = "Key test failed: " + e.message; }
  };
  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hireagents-backup.json"; a.click();
  };
  $("#resetBtn").onclick = () => { if (confirm("Reset everything? This clears tasks, bids, ledger, and ratings.")) { localStorage.removeItem(KEY); state = defaultState(); location.hash = ""; render(); } };
}

function topUp() {
  state.balance += 500;
  state.ledger.push({ id: uid(), at: new Date().toISOString(), kind: "grant", amount: 500, note: "Demo top-up", balanceAfter: state.balance });
  save(); render();
}

// ---------- auction ----------
function wireBoard() {
  $("#taskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const task = { id: uid(), title: fd.get("title").trim(), description: (fd.get("description") || "").trim(), category: fd.get("category"), budget: Number(fd.get("budget")), createdAt: new Date().toISOString(), status: "open" };
    const errs = validateTask(task, state.balance);
    const errEl = $("#formError");
    if (errs.length) { errEl.hidden = false; errEl.textContent = errs.join(" "); return; }
    state.tasks.unshift(task);
    save();
    startAuction(task);
  });
  document.querySelectorAll("[data-seed]").forEach((b) => b.onclick = () => {
    const seed = SEEDED_TASKS.find((t) => t.id === b.dataset.seed);
    const task = { id: seed.id, title: seed.title, description: seed.description, category: seed.category, budget: seed.budget, createdAt: new Date().toISOString(), status: "open" };
    state.tasks.unshift(task);
    save();
    startAuction(task, seed);
  });
  const endBtn = $("#endAuction");
  if (endBtn) endBtn.onclick = () => endAuction();
  const hireBtn = $("#hireWinner");
  if (hireBtn) hireBtn.onclick = () => hireTopBid();
  document.querySelectorAll("[data-hire]").forEach((b) => b.onclick = () => hirePersona(b.dataset.hire));
  const t1 = $("#topup1"); if (t1) t1.onclick = () => topUp();
  const copyBtn = $("#copyOut"); if (copyBtn) copyBtn.onclick = () => { const t = state.tasks.find((x) => x.status === "awarded" || x.status === "done"); navigator.clipboard.writeText(state.outputs[t.id].body); copyBtn.textContent = "Copied"; };
  const dlBtn = $("#dlOut"); if (dlBtn) dlBtn.onclick = () => downloadOutput();
  const acc = $("#acceptWork"); if (acc) acc.onclick = () => acceptWork();
  const rev = $("#askRevision"); if (rev) rev.onclick = () => askRevision();
}

function startAuction(task, seed) {
  stopAuctionTimers();
  task.status = "auction";
  const baseBids = seed ? seed.bids.map((b) => ({ ...b, source: "cached" })) : makeTemplateBids(task).map((b) => ({ ...b, source: "template" }));
  state.bids[task.id] = baseBids.map((b) => ({ ...b, id: uid(), revealed: false }));
  save();
  auction = { taskId: task.id, secondsLeft: 60, index: 0 };
  render();
  const revealNext = async () => {
    if (!auction || auction.taskId !== task.id) return;
    if (auction.index >= state.bids[task.id].length) return;
    const bid = state.bids[task.id][auction.index];
    if (liveMode()) {
      try {
        const live = await liveBid(state.settings.apiKey, state.settings.model, persona(bid.personaId), task);
        Object.assign(bid, live);
      } catch (err) {
        bid.fallbackNote = "live call failed (" + String(err.message).slice(0, 80) + ") — showing cached bid";
      }
    }
    bid.revealed = true;
    auction.index++;
    save(); render();
    if (auction.index < state.bids[task.id].length) {
      auction.revealTimer = setTimeout(revealNext, liveMode() ? 3000 : 1500);
    }
  };
  revealNext();
  auction.countdown = setInterval(() => {
    if (!auction) return;
    auction.secondsLeft--;
    const el = $(".timer-num");
    if (el) el.textContent = auction.secondsLeft + "s";
    if (auction.secondsLeft <= 0) endAuction();
  }, 1000);
}

function stopAuctionTimers() {
  if (auction) { clearInterval(auction.countdown); clearTimeout(auction.revealTimer); auction = null; }
  if (execTimer) { clearInterval(execTimer); execTimer = null; }
}

function endAuction() {
  if (!auction) return;
  const task = state.tasks.find((t) => t.id === auction.taskId);
  stopAuctionTimers();
  if (task && task.status === "auction") {
    task.status = "decided";
    (state.bids[task.id] || []).forEach((b) => { b.revealed = true; });
    save();
  }
  render();
}

function hireTopBid() {
  const task = state.tasks.find((t) => t.status === "decided");
  if (!task) return;
  const scored = scoreAllBids((state.bids[task.id] || []).filter((b) => b.revealed !== false), task);
  const winner = pickWinner(scored);
  if (winner) hirePersona(winner.personaId);
}

function hirePersona(personaId) {
  const task = state.tasks.find((t) => t.status === "decided" || t.status === "auction");
  if (!task) return;
  const bid = (state.bids[task.id] || []).find((b) => b.personaId === personaId);
  if (!bid || state.balance < bid.price) return;
  endAuctionSilent();
  task.status = "awarded";
  task.winnerId = personaId;
  task.paidPrice = bid.price;
  state.balance -= bid.price;
  state.ledger.push({ id: uid(), at: new Date().toISOString(), kind: "charge", amount: bid.price, note: `Hired ${persona(personaId).name} for "${task.title}"`, balanceAfter: state.balance });
  save();
  runExecution(task, bid);
}

function endAuctionSilent() { stopAuctionTimers(); }

function runExecution(task, bid) {
  const seed = SEEDED_TASKS.find((t) => t.id === task.id);
  // The pre-generated output belongs to the seeded winner only. Hiring anyone
  // else on a seeded task gets the honest template output, not someone else's work.
  const seededOut = seed && task.winnerId === SEEDED_OUTPUTS[seed.id].winnerId ? SEEDED_OUTPUTS[seed.id] : null;
  const steps = seededOut ? seededOut.steps : makeTemplateOutput(task, bid).steps;
  const out = { title: task.title, body: "", visibleBody: "", steps, currentStep: steps[0], source: liveMode() ? "live" : (seededOut ? "cached" : "template") };
  state.outputs[task.id] = out;
  save(); render();
  const finish = (fullBody, review) => {
    out.body = fullBody; out.visibleBody = fullBody; out.currentStep = "Done";
    state.outputs[task.id] = out;
    const p = state.personas.find((x) => x.id === task.winnerId);
    const score5 = Math.round(((review.accuracy + review.completeness + review.usefulness) / 3) * 10) / 10;
    const updated = updateRating(p, score5);
    p.rating = updated.rating; p.jobs = updated.jobs;
    state.reviews.push({ id: uid(), taskId: task.id, personaId: task.winnerId, ...review, at: new Date().toISOString() });
    save(); render();
  };
  const doReview = async (fullBody) => {
    if (liveMode()) {
      try { return await liveReview(state.settings.apiKey, state.settings.model, task, fullBody); } catch { /* fall through to cached review */ }
    }
    return seededOut ? seededOut.review : makeTemplateOutput(task, bid).review;
  };
  if (liveMode()) {
    let stepIdx = 0;
    const stepTimer = setInterval(() => { stepIdx = Math.min(steps.length - 1, stepIdx + 1); out.currentStep = steps[stepIdx]; const el = $("#stepLine"); if (el) el.textContent = out.currentStep; }, 2500);
    liveExecute(state.settings.apiKey, state.settings.model, persona(task.winnerId), task, bid, (full) => {
      out.body = full; out.visibleBody = full;
      const el = $("#outputText"); if (el) el.textContent = full;
    }).then(async ({ text }) => {
      clearInterval(stepTimer);
      finish(text, await doReview(text));
    }).catch(async () => {
      clearInterval(stepTimer);
      const fallback = seededOut ? seededOut.body : makeTemplateOutput(task, bid).body;
      finish(fallback, seededOut ? seededOut.review : makeTemplateOutput(task, bid).review);
    });
    return;
  }
  // Cached / template: reveal the pre-generated output in chunks, labelled as a replay.
  const fullBody = seededOut ? seededOut.body : makeTemplateOutput(task, bid).body;
  const chunks = fullBody.split("\n");
  let i = 0, stepIdx = 0;
  out.currentStep = steps[0];
  execTimer = setInterval(() => {
    i = Math.min(chunks.length, i + 3);
    out.visibleBody = chunks.slice(0, i).join("\n");
    stepIdx = Math.min(steps.length - 1, Math.floor((i / chunks.length) * steps.length));
    out.currentStep = i >= chunks.length ? "Done" : steps[stepIdx];
    const el = $("#outputText"); if (el) el.textContent = out.visibleBody;
    const sl = $("#stepLine"); if (sl) sl.textContent = out.currentStep;
    if (i >= chunks.length) {
      clearInterval(execTimer); execTimer = null;
      finish(fullBody, seededOut ? seededOut.review : makeTemplateOutput(task, bid).review);
    }
  }, 120);
}

function acceptWork() {
  const task = state.tasks.find((t) => t.status === "awarded");
  if (!task) return;
  task.status = "done";
  save(); render();
}

function askRevision() {
  const task = state.tasks.find((t) => t.status === "awarded");
  if (!task) return;
  const seed = SEEDED_TASKS.find((t) => t.id === task.id);
  const out = state.outputs[task.id];
  const bid = (state.bids[task.id] || []).find((b) => b.personaId === task.winnerId);
  const revision = seed && SEEDED_OUTPUTS[seed.id] ? SEEDED_OUTPUTS[seed.id].revision : makeTemplateOutput(task, bid).revision;
  out.body = out.body + "\n\n---\n\n" + revision;
  out.visibleBody = out.body;
  save(); render();
}

function downloadOutput() {
  const task = state.tasks.find((t) => t.status === "awarded" || t.status === "done");
  if (!task) return;
  const out = state.outputs[task.id];
  const blob = new Blob([`# ${out.title}\n\n${out.body}`], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = task.id + "-deliverable.md";
  a.click();
}

// ---------- nav ----------
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  state.tab = b.dataset.tab;
  stopAuctionTimers();
  render();
  window.scrollTo({ top: 0 });
}));

render();
