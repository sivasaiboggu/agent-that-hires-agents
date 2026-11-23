// Headless-Chromium screenshots via CDP: desktop 1280px + mobile 390px, file:// URLs.
// Seeds localStorage with a mid-auction state so the shots show real bids,
// then a finished state so the work panel + review are visible.
// Run: node scripts/shots.mjs — writes screenshots/*.png
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS, SEEDED_TASKS, SEEDED_OUTPUTS } from "../src/data.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const CHROME = "/opt/meta-chromium/chrome";
const DEBUG_PORT = 9228;

function seedState(kind) {
  const seed = SEEDED_TASKS[0];
  const out = SEEDED_OUTPUTS[seed.id];
  const task = {
    id: seed.id, title: seed.title, description: seed.description,
    category: seed.category, budget: seed.budget,
    createdAt: "2026-11-23T10:00:00.000Z",
    status: kind === "auction" ? "decided" : "done",
    winnerId: "mara", paidPrice: 60,
  };
  const bids = seed.bids.map((b, i) => ({ ...b, id: "bid-" + i, revealed: true, source: "cached" }));
  const base = {
    settings: { apiKey: "", model: "gemini-3.5-flash" },
    balance: 940,
    personas: JSON.parse(JSON.stringify(PERSONAS)),
    tasks: [task],
    bids: { [seed.id]: bids },
    outputs: { [seed.id]: { title: seed.title, body: out.body, visibleBody: out.body, steps: out.steps, currentStep: "Done", source: "cached" } },
    ledger: [
      { id: "grant-1", at: "2026-11-23T09:00:00.000Z", kind: "grant", amount: 1000, note: "Opening grant — demo credits, no real money", balanceAfter: 1000 },
      { id: "charge-1", at: "2026-11-23T10:05:00.000Z", kind: "charge", amount: 60, note: `Hired Mara for "${seed.title}"`, balanceAfter: 940 },
    ],
    reviews: [{ id: "rev-1", taskId: seed.id, personaId: "mara", ...out.review, at: "2026-11-23T10:08:00.000Z" }],
    tab: "board",
  };
  if (kind === "auction") { base.outputs = {}; base.reviews = []; base.ledger = base.ledger.slice(0, 1); base.balance = 1000; delete base.tasks[0].winnerId; delete base.tasks[0].paidPrice; }
  return base;
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1; this.pending = new Map(); this.events = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    };
  }
  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const done = new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return done;
  }
  async waitForEvent(method, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0];
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for " + method);
      await delay(100);
    }
  }
  async evaluate(expression) {
    const res = await this.call("Runtime.evaluate", { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

const SHOTS = [
  { name: "desktop-auction.png", width: 1280, kind: "auction" },
  { name: "desktop-done.png", width: 1280, kind: "done" },
  { name: "mobile-auction.png", width: 390, kind: "auction" },
  { name: "mobile-done.png", width: 390, kind: "done" },
];

async function main() {
  const policy = "hatch-webgl-allowed-domains-v1\nexample.com\n";
  const file = path.join(os.tmpdir(), "hireagents-webgl-policy.txt");
  fs.writeFileSync(file, policy);
  const sha = createHash("sha256").update(policy).digest("hex");
  const pageUrl = `file://${ROOT}/index.html`;
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--allow-file-access-from-files",
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "hireagents-chrome-"))}`,
    `--hatch-webgl-allowed-domains-file=${file}`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--window-size=1280,900", pageUrl,
  ]);
  try {
    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === "page");
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch { /* not up yet */ }
      await delay(200);
    }
    if (!wsUrl) throw new Error("Chrome DevTools did not come up");
    const cdp = new Cdp(wsUrl);
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    for (const shot of SHOTS) {
      await cdp.call("Emulation.setDeviceMetricsOverride", { width: shot.width, height: 844, deviceScaleFactor: 1, mobile: shot.width < 600 });
      await cdp.call("Page.navigate", { url: pageUrl });
      await cdp.waitForEvent("Page.loadEventFired");
      await delay(400);
      await cdp.evaluate(`localStorage.setItem('hireagents.v1', ${JSON.stringify(JSON.stringify(seedState(shot.kind)))})`);
      await cdp.call("Page.navigate", { url: pageUrl });
      await cdp.waitForEvent("Page.loadEventFired");
      await delay(1200);
      const overflow = await cdp.evaluate(`JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
      const { data } = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(ROOT, "screenshots", shot.name), Buffer.from(data, "base64"));
      console.log("wrote", shot.name, overflow);
    }
    cdp.close();
  } finally { chrome.kill("SIGTERM"); }
}

main().catch((err) => { console.error(err); process.exit(1); });
