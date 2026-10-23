/**
 * Смоук-тесты по HTTP на настоящей сборке (npm run build) и пустой базе:
 *   1. регистрация с кодом → подтверждение email → онбординг → первая трата;
 *   2. приглашение → регистрация по ссылке → принятие → семейная трата видна обоим;
 *   3. выход → разбор (забрать счёт) → архив только для чтения.
 * Запуск: DATABASE_URL=<пустая база с миграциями> [NEON_WSPROXY=…] npm run smoke
 * Сервер стартует сам на SMOKE_PORT (3125) без RESEND_API_KEY: письма он печатает в консоль, ссылки берутся оттуда
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../lib/data/postgres/schema.ts";
import { neonPool } from "../lib/data/postgres/neon.ts";
import { createSignupCode } from "../lib/codes.ts";

const PORT = process.env.SMOKE_PORT ?? "3125";
const BASE = `http://127.0.0.1:${PORT}`;
if (!process.env.DATABASE_URL) throw new Error("Нужен DATABASE_URL пустой базы с миграциями (npm run db:migrate)");
if (/neon\.tech/.test(process.env.DATABASE_URL) && !process.argv.includes("--production")) throw new Error("Похоже на Neon: смоук пишет тестовых пользователей. Если это намеренно — --production");

// ---------- Сервер и его письма ----------
let log = "";
const server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", PORT], {
  env: { ...process.env, RESEND_API_KEY: "", SMTP_HOST: "", TURNSTILE_SECRET_KEY: "", REGISTRATION_MODE: "invite", BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => server.kill();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) {
  if (i > 60) throw new Error(`Сервер не поднялся:\n${log}`);
  try { if ((await fetch(`${BASE}/login`)).ok) break; } catch {}
  await sleep(500);
}
/** Ссылка из последнего письма на email */
async function mailLink(email) {
  for (let i = 0; i < 20; i++) {
    const blocks = log.split("[mail] ").filter((b) => b.startsWith(email));
    const link = blocks.length && /https?:\/\/\S+/.exec(blocks.at(-1))?.[0];
    if (link) return link;
    await sleep(250);
  }
  throw new Error(`Нет письма для ${email}`);
}

// ---------- Клиент с cookie ----------
function client(ip) {
  let cookie = "";
  const go = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(path.startsWith("http") ? path : BASE + path, {
      method, redirect: "manual",
      headers: { origin: BASE, "x-forwarded-for": ip, cookie, ...(body && { "content-type": "application/json" }) },
      body: body && JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const name = kv.split("=")[0];
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, location: res.headers.get("location") };
  };
  return go;
}
const ok = (r, what) => assert.ok(r.status >= 200 && r.status < 400, `${what}: ${r.status} ${JSON.stringify(r.json)}`);
const day = new Date().toISOString().slice(0, 10);
const expense = (scope, note) => ({ kind: "expense", entry: { id: crypto.randomUUID(), amount: 300, currency: "RSD", rate: 1, base: 300, catId: "", note, date: day, ts: Date.now(), scope } });

const pool = neonPool(process.env.DATABASE_URL);
const db = drizzle({ client: pool, schema });
const tag = randomBytes(3).toString("hex");
const A = { email: `smoke-a-${tag}@example.test`, password: "смоук-пароль-1", name: "Анна" };
const B = { email: `smoke-b-${tag}@example.test`, password: "смоук-пароль-2", name: "Борис" };

async function signUpAndVerify(go, u, extra) {
  ok(await go("/api/auth/sign-up/email", { method: "POST", body: { ...u, ...extra } }), `регистрация ${u.email}`);
  const v = await go(await mailLink(u.email));
  assert.equal(v.status, 302, "ссылка подтверждения");
  return v.location;
}

try {
  // 1. Регистрация с кодом → онбординг → первая трата
  const a = client("10.50.0.1");
  assert.equal((await a("/api/auth/sign-up/email", { method: "POST", body: { ...A } })).json?.code, "SIGNUP_CODE_INVALID", "без кода — отказ");
  const { code } = await createSignupCode(db, null, 1, 1);
  await signUpAndVerify(a, A, { signupCode: code });
  let data = await a("/api/data");
  ok(data, "данные после подтверждения");
  assert.equal(data.json.solo, true, "solo-бюджет");
  assert.equal(data.json.settings, null, "экран :: НАСТРОЙКА");
  ok(await a("/api/settings", { method: "PUT", body: { version: 0, data: { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [] } } }), "настройка");
  ok(await a("/api/my-settings", { method: "PUT", body: { version: 0, data: { personalCategories: [{ id: "food", name: "Еда", limit: 30000 }] } } }), "стартовые категории");
  const first = expense("personal", "первая трата");
  first.entry.catId = "food";
  ok(await a("/api/entries", { method: "POST", body: first }), "первая трата");
  data = await a("/api/data");
  assert.ok(Object.values(data.json.myExpenses).flat().some((e) => e.note === "первая трата"));
  console.log("✓ 1. регистрация с кодом → онбординг → первая трата");

  // 2. Приглашение → регистрация по ссылке → принятие → семейная трата
  const inv = await a("/api/family/invites", { method: "POST" });
  ok(inv, "приглашение");
  const b = client("10.50.0.2");
  const back = await signUpAndVerify(b, B, { inviteCode: inv.json.code, callbackURL: `/join/${inv.json.code}` });
  assert.match(back, new RegExp(`/join/${inv.json.code}$`), "после подтверждения — на /join");
  const preview = await b(`/api/join/${inv.json.code}`);
  ok(preview, "экран подтверждения");
  assert.equal(preview.json.inviter, A.name);
  ok(await b(`/api/join/${inv.json.code}`, { method: "POST", body: {} }), "принять");
  assert.equal((await b(`/api/join/${inv.json.code}`, { method: "POST", body: {} })).status, 404, "повторно — недействительно");
  ok(await b("/api/settings", { method: "PUT", body: { version: (await b("/api/data")).json.settings.version, data: { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [{ id: "home", name: "Дом", limit: 1000 }] } } }), "семейная категория");
  const fam = expense("family", "семейная трата");
  fam.entry.catId = "home";
  ok(await b("/api/entries", { method: "POST", body: fam }), "семейная трата");
  const seenByA = await a("/api/data");
  assert.equal(seenByA.json.solo, undefined, "бюджет стал семейным");
  assert.equal(seenByA.json.partner.name, B.name);
  assert.ok(Object.values(seenByA.json.familyExpenses).flat().some((e) => e.note === "семейная трата"), "трата видна обоим");
  assert.ok(!JSON.stringify((await b("/api/data")).json).includes("первая трата"), "личное Анны Борису не видно");
  console.log("✓ 2. приглашение → принятие → семейная трата");

  // 3. Выход → разбор → архив
  ok(await a("/api/accounts", { method: "POST", body: { name: "Общий", currency: "RSD", balance: 5000, scope: "family" } }), "семейный счёт");
  assert.equal((await b("/api/family/leave", { method: "POST", body: { confirm: "нет" } })).status, 400, "без слова ВЫЙТИ — нет");
  const left = await b("/api/family/leave", { method: "POST", body: { confirm: "ВЫЙТИ" } });
  ok(left, "выход");
  assert.equal(left.json.dissolved, true);
  const F = left.json.householdId;
  const review = await b(`/api/archive/${F}/review`);
  ok(review, "разбор");
  const acc = review.json.accounts.find((x) => x.name === "Общий");
  ok(await b(`/api/archive/${F}/review`, { method: "POST", body: { action: "claim-account", id: acc.id } }), "забрать счёт");
  assert.equal((await a(`/api/archive/${F}/review`, { method: "POST", body: { action: "claim-account", id: acc.id } })).status, 409, "второй не забирает");
  assert.equal((await a("/api/data")).json.pendingReview?.householdId, F, "у оставшегося — экран разбора при входе");
  const arch = await b(`/api/archive/${F}`);
  ok(arch, "архив");
  assert.ok(arch.json.readonly);
  assert.ok(Object.values(arch.json.familyExpenses).flat().some((e) => e.note === "семейная трата"));
  assert.equal((await b(`/api/archive/${F}`, { method: "POST", body: {} })).status, 403, "архив только для чтения");
  assert.ok((await b("/api/data")).json.savings.accounts.mine.some((x) => x.name === "Общий"), "забранный счёт — у Бориса");
  assert.ok(!JSON.stringify((await a("/api/data")).json).includes("семейная трата"), "в solo Анны семейного нет");
  console.log("✓ 3. выход → разбор → архив");
  console.log("Смоук пройден");
} catch (e) {
  console.error(e);
  console.error("--- лог сервера (хвост) ---\n" + log.slice(-3000));
  process.exitCode = 1;
} finally {
  stop();
  await pool.end();
}
