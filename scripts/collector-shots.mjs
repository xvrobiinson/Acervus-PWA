// Seeds a SYNTHETIC business with an admin and two collectors on a *local*
// Convex deployment and captures screenshots of the collector features
// (assigning clients, payments waiting for confirmation, the bell) with a
// headless Edge (its own throw-away profile; nothing is shown on screen and
// no input reaches other programs). Requires the local backend
// (`CONVEX_AGENT_MODE=anonymous npx convex dev`, SITE_URL and
// BETTER_AUTH_SECRET set, no RESEND_API_KEY so sign-in codes go to the log)
// and the Vite dev server on :5173 pointed at it.
//
// Usage: node scripts/collector-shots.mjs <convex-dev-log> <out-dir> <local-project-dir> [edge.exe]

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const [log, outDir, localDir, edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"] = process.argv.slice(2);
const SITE = "http://127.0.0.1:3211";
const CLOUD = "http://127.0.0.1:3210";
const APP = "http://localhost:5173";
if (!CLOUD.includes("127.0.0.1")) throw new Error("local only");
mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- accounts ------------------------------------------------------------
async function account(name) {
  const email = `${name.split(" ")[0].toLowerCase()}-${Date.now()}@example.com`;
  const stored = {};
  const auth = async (path, body, method = "POST") => {
    const cookie = Object.entries(stored).map(([k, v]) => `${k}=${v.value}`).join("; ");
    const res = await fetch(`${SITE}/api/auth${path}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: APP, "Better-Auth-Cookie": cookie },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-better-auth-cookie");
    if (set) {
      for (const part of set.split(/,(?=\s*[\w.-]+=)/)) {
        const [pair, ...attrs] = part.split(";").map((s) => s.trim());
        const [k, ...rest] = pair.split("=");
        const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
        stored[k] = { value: rest.join("="), expires: maxAge ? new Date(Date.now() + Number(maxAge.split("=")[1]) * 1000).toISOString() : null };
      }
    }
    return res.json().catch(() => null);
  };
  await auth("/email-otp/send-verification-otp", { email, type: "sign-in" });
  let code;
  for (let i = 0; i < 20 && !code; i++) {
    await wait(500);
    code = readFileSync(log, "utf8")
      .split(/\r?\n/)
      .reverse()
      .filter((l) => l.includes(email))
      .map((l) => l.match(/CODE: (\d{6})/)?.[1])
      .find(Boolean);
  }
  await auth("/sign-in/email-otp", { email, otp: code, name });
  const { token } = await auth("/convex/token", null, "GET");
  const session = await auth("/get-session", null, "GET");
  const c = new ConvexHttpClient(CLOUD);
  c.setAuth(token);
  return { name, email, c, stored, session, userId: session.user.id };
}

const rosa = await account("Rosa Admin");
const ana = await account("Ana Pérez");
const luis = await account("Luis Mejía");
const c = rosa.c;
const businessId = await c.mutation(api.businesses.create, { name: "VZ Capital Group", timezone: "America/Santo_Domingo", language: "en", currencyCode: "DOP" });
for (const who of [ana, luis]) {
  const { url } = await c.action(api.invites.create, { businessId, email: who.email, role: "collector" });
  await who.c.mutation(api.invites.accept, { token: url.split("#token=")[1] });
}
const today = (await c.query(api.data.snapshot, { businessId })).today;
const day = (months, days = 0) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
await c.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 80_000_000, occurredOn: day(-5), notes: "Capital" });
const names = ["María Rodríguez", "José Martínez", "Carmen Peña", "Rafael Gómez", "Yolanda Castillo", "Luisa Fernández", "Pedro Almonte"];
const ids = {};
for (const fullName of names) {
  ids[fullName] = (await c.mutation(api.clients.create, { businessId, opId: crypto.randomUUID(), fullName, phone: "809-555-0100", email: "", idNumber: "", address: "Santo Domingo", notes: "" })).clientId;
}
const terms = (o) => ({ principal: 1_000_000, rate: 100_000, interestPeriod: "monthly", frequency: "monthly", method: "declining", installments: 6, lateFeeRate: 50_000, ...o });
const loanOf = {};
for (const [i, n] of names.entries()) {
  // Yolanda's first installment is due in two days (the reminder).
  const startDate = n === "Yolanda Castillo" ? day(-1, 2) : day(-2, -i);
  loanOf[n] = await c.mutation(api.loans.create, { businessId, clientId: ids[n], schedule: null, notes: "", terms: terms({ principal: 1_000_000 + i * 350_000, startDate }) });
}
await c.mutation(api.clients.assign, { businessId, clientIds: [ids["María Rodríguez"], ids["José Martínez"], ids["Pedro Almonte"]], collectorId: ana.userId });
await c.mutation(api.clients.assign, { businessId, clientIds: [ids["Carmen Peña"]], collectorId: luis.userId });
await c.mutation(api.clients.assign, { businessId, clientIds: [ids["Rafael Gómez"]], collectorId: rosa.userId });
const collect = async (who, n, amount, paidOn) =>
  (await who.c.mutation(api.payments.record, { businessId, opId: crypto.randomUUID(), loanId: loanOf[n], loanVersion: 0, amount, fee: 0, paidOn, notes: "", instruction: { kind: "auto" } })).pendingId;
// HIDE_VIEW=1: Ana sees less, to check the switches.
if (process.env.HIDE_VIEW) {
  const m = (await c.query(api.businesses.members, { businessId })).find((x) => x.userId === ana.userId);
  await c.mutation(api.businesses.setCollectorView, { businessId, memberId: m._id, view: { amountLent: false, rate: false, contact: false, idNumber: false, history: false, lateFees: false, notes: false } });
}
const p1 = await collect(ana, "Pedro Almonte", 175_000, day(0, -6));
const p2 = await collect(ana, "José Martínez", 50_000, day(0, -5));
await collect(ana, "María Rodríguez", 250_000, day(0, -1));
await collect(ana, "José Martínez", 180_000, day(0, 0));
await collect(luis, "Carmen Peña", 150_000, day(0, 0));
await c.mutation(api.payments.confirm, { businessId, pendingId: p1 });
await c.mutation(api.payments.reject, { businessId, pendingId: p2, reason: "Recorded twice" });
// JSON5 with no spaces or double quotes, so the Windows shell passes it as is.
spawnSync(`npx convex run messages:remindBusiness {businessId:'${businessId}'}`, {
  cwd: localDir,
  env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  shell: true,
  stdio: "inherit",
});
console.log(`seeded ${businessId}`);
// For the desktop app: the business and each person's session cookies.
const cookie = (who) => Object.entries(who.stored).map(([k, v]) => `${k}=${v.value}`).join("; ");
writeFileSync(join(outDir, "seed.json"), JSON.stringify({ businessId, admin: { email: rosa.email, cookie: cookie(rosa) }, collector: { email: ana.email, cookie: cookie(ana) } }));
if (process.env.SEED_ONLY) process.exit(0);

// ----- headless Edge over the DevTools protocol ----------------------------
const port = 9334;
const browser = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, "edge-profile")}`, "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await wait(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pendingCalls = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendingCalls.has(m.id)) {
    pendingCalls.get(m.id)(m.result ?? m);
    pendingCalls.delete(m.id);
  }
});
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pendingCalls.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = (expression) => cdp("Runtime.evaluate", { expression, awaitPromise: true });
async function shot(name, path, before, full = false) {
  if (path) {
    await cdp("Page.navigate", { url: `${APP}${path}` });
    await wait(3500);
  }
  if (before) {
    await evalJs(before);
    await wait(1200);
  }
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`saved ${name}.png`);
}
const size = (width, height, mobile) => cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
async function signIn(who) {
  await cdp("Page.navigate", { url: `${APP}/sign-in` });
  await wait(2000);
  await evalJs(`localStorage.clear(); indexedDB.databases?.().then(l => l.forEach(d => indexedDB.deleteDatabase(d.name)));
    localStorage.setItem("better-auth_cookie", ${JSON.stringify(JSON.stringify(who.stored))});
    localStorage.setItem("better-auth_session_data", ${JSON.stringify(JSON.stringify(who.session))});
    localStorage.setItem("acervus.lang", "en");`);
}
const click = (re, scope = "") => `[...document.querySelectorAll("${scope} button, ${scope} a")].find(b => ${re}.test(b.textContent))?.click()`;

await cdp("Page.enable");
await cdp("Runtime.enable");
// The admin, on a wide screen.
await size(1366, 900, false);
await signIn(rosa);
await shot("a01-overview", "/");
await shot("a02-messages", null, `document.querySelector(".nav-rail .bell").click()`);
await shot("a03-confirm", "/confirm");
await shot("a04-reject", null, click("/^Reject$/", ".main"));
await shot("a05-clients", "/clients");
await shot("a06-clients-unassigned", "/clients?collector=none");
await shot("a07-assign", "/clients", click("/^Assign$/", ".topbar"));
await shot("a08-client-detail", `/clients/${ids["María Rodríguez"]}`);
await shot("a09-loan-pending", `/loans/${loanOf["María Rodríguez"]}`);
await shot("a11-settings", "/settings");
await shot("a12-team", null, `[...document.querySelectorAll(".settings-cats button")].find(b => /Team/.test(b.textContent)).click()`);
// The admin, on a phone.
await size(390, 844, true);
await shot("a10-phone-confirm", "/confirm");
// A collector, on a phone.
await signIn(ana);
await shot("c01-overview", "/");
await shot("c02-overview-scrolled", null, `window.scrollTo(0, document.body.scrollHeight)`);
await shot("c03-messages", "/", `document.querySelector(".phone-only .bell").click()`);
await shot("c04-clients", "/clients");
await shot("c05-payment-form", `/loans/${loanOf["María Rodríguez"]}`, click("/Record payment/"));
await shot("c07-loan", `/loans/${loanOf["María Rodríguez"]}`, null, true);
await shot("c08-loan-receipt", `/loans/${loanOf["María Rodríguez"]}`, click("/Loan receipt/"));
await shot("c09-client", `/clients/${ids["María Rodríguez"]}`, null, true);
await shot("c06-pending-receipt", `/loans/${loanOf["María Rodríguez"]}`, `document.querySelector('.list [aria-label="Receipt"]').click()`);
ws.close();
browser.kill();
