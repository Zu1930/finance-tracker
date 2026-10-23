// Репозитории: один набор сценариев для Redis (фейковый Upstash в памяти) и Postgres (PGlite с миграциями drizzle/).
// 1) Сценарий: одни и те же вызовы дают одинаковые результаты и одинаковые ответы buildView в обеих реализациях.
// 2) Изоляция: два бюджета, три пользователя — чужой бюджет и чужое личное недоступны ни одним методом.
//    Последний тест каждой реализации падает, если какой-то метод не покрыт проверкой изоляции.
// Запуск: npm run test (с --conditions=react-server — иначе server-only не даст загрузить модули)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { startFakeUpstash } from "./test/fake-upstash.mjs";

const fake = await startFakeUpstash();
process.env.KV_REST_API_URL = fake.url;
process.env.KV_REST_API_TOKEN = "test";
process.env.USERS = "vlad:Влад,masha:Маша";
const { redisRepos } = await import("./redis/repos.ts");
const { postgresRepos } = await import("./postgres/repos.ts");
const schema = await import("./postgres/schema.ts");
const { buildView } = await import("../store.ts");
const { rebaseStore } = await import("../rebase.ts");
after(() => fake.close());

const H = "default";
const V = { userId: "vlad", householdId: H }, M = { userId: "masha", householdId: H }, O = { userId: "olga", householdId: "h2" };
const users = { vlad: { id: "vlad", name: "Влад" }, masha: { id: "masha", name: "Маша" } };

const IMPLS = {
  redis: async () => (fake.reset(), redisRepos(Object.values(users))),
  postgres: async () => {
    const client = new PGlite();
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    await client.exec(`
      INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга');
      INSERT INTO households (id, name) VALUES ('default', 'Семья'), ('h2', 'Другая');
      INSERT INTO memberships (household_id, user_id, role, joined_at) VALUES
        ('default', 'vlad', 'owner', '2026-01-01'), ('default', 'masha', 'member', '2026-01-02'), ('h2', 'olga', 'owner', '2026-01-01');
    `);
    return postgresRepos(db);
  },
};

// ---------- Данные ----------
const T = "2026-10-20", CUR = "2026-10", NEXT = "2026-11";
const settingsDoc = {
  base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117, USD: null }, schemaVersion: 3,
  familyCategories: [{ id: "home", name: "Дом", limit: 20000, history: [{ until: "2026-09", limit: 15000 }] }, { id: "food", name: "Еда", limit: 40000, since: "2026-03" }, { id: "old", name: "Старое", limit: 1, archived: true, archivedFrom: "2026-05" }],
  incomeSources: [{ id: "salary", name: "Зарплата" }],
};
let n = 0;
const ex = (who, extra = {}) => ({ id: `x${++n}`, amount: 1000, currency: "RSD", rate: 1, base: 1000, catId: "food", note: "n", date: T, ts: 1_760_000_000_000 + n, scope: "family", authorId: who, ...extra });
const inc = (id, extra = {}) => ({ id, amount: 1000, currency: "EUR", rate: 117.25, base: 117250, sourceId: "salary", note: "", date: T, ts: 1_760_000_000_000, authorId: "vlad", ...extra });
const acc = (id, scope, owner, extra = {}) => ({ id, name: id, currency: "RSD", scope, ...(owner && { ownerId: owner }), balance: 1000, initial: 1000, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: owner ?? "vlad", version: 1, ...extra });
const goal = (id, scope, owner) => ({ id, name: id, target: 5000, currency: "EUR", allocated: 100, scope, ...(owner && { ownerId: owner }), ops: [{ id: `${id}-op`, amount: 100, date: T, ts: 5, by: owner ?? "vlad" }], version: 1 });
const item = (id, scope, owner, extra = {}) => ({ id, month: CUR, name: id, amount: 25000, categoryId: scope === "personal" ? "hobby" : "home", scope, ...(owner && { ownerId: owner }), createdBy: owner ?? "vlad", expenseIds: [], version: 1, ...extra });
const pay = (id, scope, owner, extra = {}) => ({
  id, name: id, currency: "EUR", approx: false, frequency: "monthly", day: 5, categoryId: scope === "personal" ? "hobby" : "home", scope, ...(owner && { ownerId: owner }),
  startMonth: CUR, paused: false, skips: [], amounts: [{ fromMonth: CUR, amount: 500 }], createdBy: owner ?? "vlad", version: 1, ...extra,
});
const recon = (id, at, balances) => ({ id, at, day: T, by: "vlad", balances, rates: { EUR: 117 }, totals: { family: 1000, byUser: { vlad: 0, masha: 0 }, all: 1000 }, income: null, expense: null, expected: null, fact: null, gap: null });
const token = (name) => ({ name, hash: "a".repeat(64), createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: null });
const sub = (endpoint) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });

/** Сравнение без порядка в массивах и без пустых месяцев (в Redis после удаления всех записей остаётся пустой хеш) */
function canon(x) {
  if (Array.isArray(x)) return x.map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if (!x || typeof x !== "object") return x;
  const out = {};
  for (const k of Object.keys(x).sort()) {
    const v = canon(x[k]);
    if (v === undefined || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
}
/** Ответы обоим. Нулевая сумма партнёра за месяц = нет записей: клиент читает её как ?? 0 */
const views = async (r) => {
  const raw = await r.store.snapshot(V);
  const view = (me, partner) => {
    const v = buildView(raw, me, partner, CUR);
    for (const [m, t] of Object.entries(v.partnerPersonalTotals)) if (t === 0) delete v.partnerPersonalTotals[m];
    return v;
  };
  return { vlad: view(users.vlad, users.masha), masha: view(users.masha, users.vlad) };
};

// ---------- 1. Общий сценарий ----------
async function scenario(r) {
  n = 0;
  const log = [];
  const step = async (name, f) => {
    try { log.push([name, await f()]); } catch (e) { log.push([name, "throws"]); }
  };
  await step("settings.get пусто", () => r.settings.get(V));
  await step("settings.put", () => r.settings.put(V, 0, settingsDoc));
  await step("settings.put конфликт", () => r.settings.put(M, 0, settingsDoc));
  await step("settings.merge", () => r.settings.merge(V, (s) => ({ ...s, rates: { ...s.rates, EUR: 117.5 }, ratesUpdatedAt: T })));
  await step("settings.merge без записи", () => r.settings.merge(V, () => null));
  await step("settings.get", () => r.settings.get(M));
  await step("userSettings.put", () => r.userSettings.put(V, 0, { personalCategories: [{ id: "hobby", name: "Хобби", limit: 5000 }], preferredCurrency: "EUR" }));
  await step("userSettings.put masha", () => r.userSettings.put(M, 0, { personalCategories: [{ id: "beauty", name: "Красота", limit: 7000 }, { id: "home", name: "Мой дом", limit: 1 }], hideQuickEntry: true }));
  await step("userSettings.put конфликт", () => r.userSettings.put(M, 0, { personalCategories: [] }));
  await step("userSettings.get", () => r.userSettings.get(M));
  await step("categories.list", () => r.categories.list(M));

  await step("expenses.add", () => r.expenses.add(V, ex("vlad")));
  await step("expenses.add повтор перезаписывает", () => r.expenses.add(V, ex("vlad", { id: "x1", amount: 1500, base: 1500 })));
  await step("expenses.add личная", () => r.expenses.add(M, ex("masha", { scope: "personal", catId: "beauty", base: 2500, amount: 2500, date: "2026-09-15" })));
  await step("expenses.add EUR", () => r.expenses.add(V, ex("vlad", { scope: "personal", catId: "hobby", amount: 10, currency: "EUR", rate: 0.008547008547008548, base: 0.09 })));
  await step("incomes.add", () => r.incomes.add(V, inc("i1")));
  await step("incomes.add masha", () => r.incomes.add(M, inc("i2", { authorId: "masha", date: "2026-09-05" })));

  await step("planItems.create", () => r.planItems.create(V, item("pi", "family", null)));
  await step("planItems.create повтор", () => r.planItems.create(M, item("pi", "family", null)));
  await step("planItems.create личный", () => r.planItems.create(V, item("vpi", "personal", "vlad", { amount: 3000.555 })));
  await step("expenses.addForPlan", () => r.expenses.addForPlan(M, ex("masha", { id: "lp", catId: "home", base: 26000, amount: 26000, planItemId: "pi" })));
  await step("expenses.addForPlan повтор", () => r.expenses.addForPlan(M, ex("masha", { id: "lp", catId: "home", base: 26000, amount: 26000, planItemId: "pi" })));
  await step("expenses.addForPlan не та категория", () => r.expenses.addForPlan(V, ex("vlad", { planItemId: "pi" })));
  await step("expenses.addForPlan другой месяц", () => r.expenses.addForPlan(V, ex("vlad", { catId: "home", date: "2026-11-02", planItemId: "pi" })));
  await step("planItems.get", () => r.planItems.get(M, "family", CUR, "pi"));

  await step("recurring.create", () => r.recurring.create(V, pay("rent", "family", null)));
  await step("recurring.create личный", () => r.recurring.create(V, pay("vsub", "personal", "vlad", { currency: "RSD", amounts: [{ fromMonth: CUR, amount: 999 }] })));
  await step("recurring.create ежегодный", () => r.recurring.create(M, pay("year", "personal", "masha", { frequency: "yearly", month: 3, categoryId: "beauty" })));
  await step("addForRecurring", () => r.expenses.addForRecurring(M, ex("masha", { id: "rp", catId: "home", amount: 500, currency: "EUR", rate: 117, base: 58500, recurringId: "rent", recurringMonth: CUR })));
  await step("addForRecurring повтор id", () => r.expenses.addForRecurring(M, ex("masha", { id: "rp", catId: "home", recurringId: "rent", recurringMonth: CUR })));
  await step("addForRecurring вторая оплата", () => r.expenses.addForRecurring(V, ex("vlad", { catId: "home", recurringId: "rent", recurringMonth: CUR })));
  await step("addForRecurring не та категория", () => r.expenses.addForRecurring(V, ex("vlad", { recurringId: "rent", recurringMonth: NEXT })));
  await step("addForRecurring чужой личный", () => r.expenses.addForRecurring(M, ex("masha", { scope: "personal", catId: "hobby", recurringId: "vsub", recurringMonth: CUR })));
  await step("addForRecurring свой личный", () => r.expenses.addForRecurring(V, ex("vlad", { scope: "personal", catId: "hobby", base: 999, amount: 999, recurringId: "vsub", recurringMonth: CUR })));
  await step("recurring.get", () => r.recurring.get(V, "family", "rent"));
  await step("recurring.update цена", () => r.recurring.update(V, "personal", "vsub", 2, (p) => ({ ...p, amounts: [...p.amounts, { fromMonth: NEXT, amount: 1199 }], skips: ["2026-12"], name: "Подписка+" })));
  await step("recurring.update версия", () => r.recurring.update(V, "personal", "vsub", 2, (p) => p));
  await step("recurring.update отказ", () => r.recurring.update(V, "family", "rent", undefined, () => ({ status: 400, error: "нет" })));
  await step("recurring.update нет записи", () => r.recurring.update(V, "family", "nope", undefined, (p) => p));
  await step("recurring.update конец", () => r.recurring.update(M, "family", "rent", undefined, (p) => ({ ...p, endMonth: CUR })));

  await step("expenses.inMonth", () => r.expenses.inMonth(V, "family", CUR));
  await step("expenses.inMonth личные", () => r.expenses.inMonth(V, "personal", CUR));
  await step("expenses.remove связанной", () => r.expenses.remove(V, "family", CUR, "lp"));
  await step("planItems.get после удаления траты", () => r.planItems.get(V, "family", CUR, "pi"));
  await step("trash.restore партнёром", () => r.trash.restore(V, "lp"));
  await step("planItems.get после возврата", () => r.planItems.get(V, "family", CUR, "pi"));
  await step("trash.restore повтор", () => r.trash.restore(V, "lp"));
  await step("expenses.remove не тот месяц", () => r.expenses.remove(V, "family", NEXT, "x1"));
  await step("expenses.remove личной", () => r.expenses.remove(M, "personal", "2026-09", "x3"));
  await step("trash.restore чужой личной", () => r.trash.restore(V, "x3"));
  await step("trash.restore своей", () => r.trash.restore(M, "x3"));
  await step("incomes.remove", () => r.incomes.remove(M, "2026-09", "i2"));
  await step("incomes.remove нет", () => r.incomes.remove(M, "2026-09", "i2"));

  await step("accounts.create", () => r.accounts.create(V, acc("facc", "family", null)));
  await step("accounts.create повтор", () => r.accounts.create(M, acc("facc", "family", null)));
  await step("accounts.create личный", () => r.accounts.create(M, acc("macc", "personal", "masha", { currency: "EUR", balance: 500.5, initial: 500.5 })));
  await step("accounts.update", () => r.accounts.update(M, "family", "facc", 1, (a) => ({ ...a, name: "Общий" })));
  await step("accounts.update версия", () => r.accounts.update(V, "family", "facc", 1, (a) => ({ ...a, name: "Старый" })));
  await step("accounts.update архив", () => r.accounts.update(M, "personal", "macc", 1, (a) => ({ ...a, archived: true })));
  await step("goals.create", () => r.goals.create(M, goal("fgoal", "family", null)));
  await step("goals.update операция", () => r.goals.update(V, "family", "fgoal", undefined, (g) => ({ ...g, allocated: 400, ops: [...g.ops, { id: "op2", amount: 300, date: T, ts: 6, by: "vlad" }] })));
  await step("goals.create личная", () => r.goals.create(V, goal("vgoal", "personal", "vlad")));
  await step("goals.update удаление", () => r.goals.update(V, "personal", "vgoal", undefined, () => null));
  await step("goals.update удалённой", () => r.goals.update(V, "personal", "vgoal", undefined, (g) => g));
  const snap = await r.store.snapshot(V);
  const seen = [...Object.values(snap.savings.accounts), ...Object.values(snap.savings.userAccounts).flatMap((h) => Object.values(h))];
  const facc = snap.savings.accounts.facc;
  await step("recons.add", () => r.recons.add(V, recon("r1", "2026-10-20T10:00:00.000Z", { facc: 900 }), seen, [{ ...facc, balance: 900, updatedAt: "2026-10-20T10:00:00.000Z", version: facc.version + 1 }], 0));
  await step("recons.add устаревшее число", () => r.recons.add(V, recon("r2", "2026-10-20T11:00:00.000Z", {}), [], [], 0));
  await step("recons.add устаревшая версия", () => r.recons.add(M, recon("r3", "2026-10-20T12:00:00.000Z", {}), seen, [], 1));

  await step("plans.putFamily", () => r.plans.putFamily(V, NEXT, 0, { month: NEXT, incomeOverride: 280000.12, limitOverrides: { home: 30000 } }));
  await step("plans.putFamily конфликт", () => r.plans.putFamily(M, NEXT, 0, { month: NEXT, incomeOverride: null, limitOverrides: {} }));
  await step("plans.putFamily v1", () => r.plans.putFamily(M, NEXT, 1, { month: NEXT, incomeOverride: null, limitOverrides: { home: 31000 } }));
  await step("plans.putMine", () => r.plans.putMine(M, NEXT, 0, { month: NEXT, limitOverrides: { beauty: 9000 } }));
  await step("plans.putMine конфликт", () => r.plans.putMine(M, NEXT, 0, { month: NEXT, limitOverrides: {} }));
  await step("planItems.update", () => r.planItems.update(V, "personal", CUR, "vpi", 1, (it) => ({ ...it, name: "Краски", amount: 4000 })));
  await step("planItems.update версия", () => r.planItems.update(V, "personal", CUR, "vpi", 1, (it) => it));
  const vpi = await r.planItems.get(V, "personal", CUR, "vpi");
  await step("planItems.move", () => r.planItems.move(V, vpi, { ...vpi, month: NEXT, movedFrom: CUR, version: vpi.version + 1 }));
  await step("planItems.move устаревший", () => r.planItems.move(V, vpi, { ...vpi, month: NEXT, movedFrom: CUR, version: vpi.version + 1 }));
  await step("planItems.get перенесённый", () => r.planItems.get(V, "personal", NEXT, "vpi"));
  await step("planItems.update удаление", () => r.planItems.update(M, "family", CUR, "pi", undefined, () => null));

  await step("apiTokens.add", () => r.apiTokens.add(V, "t1", token("iPhone")));
  await step("apiTokens.list", () => r.apiTokens.list(V));
  await step("system.tokensOf", () => r.system.tokensOf("vlad"));
  await step("system.touchToken", () => r.system.touchToken("vlad", "t1", { ...token("iPhone"), lastUsedAt: "2026-10-20T10:00:00.000Z" }));
  await step("system.tokensOf после", () => r.system.tokensOf("vlad"));
  await step("system.hitToken 1", () => r.system.hitToken("t1"));
  await step("system.hitToken 2", () => r.system.hitToken("t1"));
  await step("apiTokens.remove", () => r.apiTokens.remove(V, "t1"));
  await step("apiTokens.remove повтор", () => r.apiTokens.remove(V, "t1"));

  await step("push.save", () => r.push.save(V, sub("https://p/v")));
  await step("push.save masha", () => r.push.save(M, sub("https://p/m")));
  await step("push.has", () => r.push.has(V, "https://p/v"));
  await step("system.subscriptions", async () => (await r.system.subscriptions(["vlad"])).map((x) => [x.userId, x.subscription]));
  await step("system.subscriptions все", async () => (await r.system.subscriptions()).map((x) => x.subscription.endpoint).sort());
  await step("push.remove", () => r.push.remove(V, "https://p/v"));
  await step("push.has после", () => r.push.has(V, "https://p/v"));
  await step("system.dropSubscription", () => r.system.dropSubscription("https://p/m"));
  await step("system.subscriptions пусто", () => r.system.subscriptions());
  await step("system.swapAppVersion", () => r.system.swapAppVersion("aaa"));
  await step("system.swapAppVersion 2", () => r.system.swapAppVersion("bbb"));
  await step("system.households", async () => (await r.system.households()).filter((h) => h.id === H));

  await step("legacy.docs", () => r.legacy.docs(V));
  await step("legacy.hasDocs", () => r.legacy.hasDocs(V));
  await step("legacy.importGoals", () => r.legacy.importGoals(V, [goal("g-old", "family", null), goal("fgoal", "family", null)]));

  const before = await views(r);
  const raw = await r.store.snapshot(V);
  await step("store.replace", () => r.store.replace(V, rebaseStore(raw, { from: "RSD", to: "EUR", rate: 117, limitRounding: 10 }, T)));
  return { log, before, after: await views(r) };
}

const results = {};
for (const name of Object.keys(IMPLS)) {
  test(`сценарий: ${name}`, async () => {
    results[name] = await scenario(await IMPLS[name]());
    // Сам сценарий проверяет ключевые ожидания независимо от второй реализации
    const log = Object.fromEntries(results[name].log);
    assert.deepEqual(log["settings.put"], { ok: true, version: 1 });
    assert.deepEqual(log["settings.put конфликт"], { ok: false, version: 1 });
    assert.equal(log["settings.get"].rates.EUR, 117.5);
    assert.deepEqual(log["addForRecurring"], { ok: true });
    assert.equal(log["addForRecurring вторая оплата"].status, 409);
    assert.equal(log["addForRecurring чужой личный"].status, 403);
    assert.equal(log["expenses.addForPlan не та категория"].status, 400);
    assert.deepEqual(log["planItems.get после удаления траты"].expenseIds, []);
    assert.deepEqual(log["planItems.get после возврата"].expenseIds, ["lp"]);
    assert.deepEqual(log["trash.restore чужой личной"], { ok: false, status: 403 });
    assert.equal(log["accounts.update версия"].status, 409);
    assert.equal(log["recons.add"], true);
    assert.equal(log["recons.add устаревшее число"], false);
    assert.equal(log["recons.add устаревшая версия"], false);
    assert.equal(log["planItems.move"], true);
    assert.equal(log["planItems.move устаревший"], false);
    assert.equal(log["system.hitToken 2"], 2);
    assert.equal(log["system.swapAppVersion 2"], "aaa");
    assert.equal(results[name].after.vlad.settings.base, "EUR");
  });
}
test("сценарий: Redis и Postgres дают одинаковые результаты и ответы", () => {
  const [a, b] = [results.redis, results.postgres];
  assert.ok(a && b, "оба сценария выполнены");
  for (let i = 0; i < a.log.length; i++) assert.deepEqual(canon(b.log[i]), canon(a.log[i]), `шаг «${a.log[i][0]}»`);
  for (const k of ["before", "after"]) for (const u of ["vlad", "masha"]) assert.deepEqual(canon(b[k][u]), canon(a[k][u]), `${k} ${u}`);
});

// ---------- 2. Изоляция ----------
/** Методы без данных конкретного бюджета или пользователя */
const EXEMPT = {
  "system.households": "служебный список бюджетов для cron",
  "system.hitToken": "счётчик по id токена, без данных",
  "system.dropSubscription": "удаление подписки, которую push-сервис уже не знает",
  "system.swapAppVersion": "общая версия приложения",
};
const methodsOf = (r) => Object.entries(r).flatMap(([repo, o]) => Object.keys(o).map((m) => `${repo}.${m}`));
function spy(r, covered) {
  return Object.fromEntries(Object.entries(r).map(([repo, o]) => [repo, Object.fromEntries(Object.entries(o).map(([m, f]) => [m, (...a) => (covered.add(`${repo}.${m}`), f(...a))]))]));
}
/** Результат или "denied", если реализация отказала исключением (Redis: другой бюджет не обслуживается) */
const attempt = async (f) => { try { return await f(); } catch { return "denied"; } };

async function seed(r) {
  await r.settings.put(V, 0, settingsDoc);
  await r.userSettings.put(V, 0, { personalCategories: [{ id: "hobby", name: "Хобби", limit: 5000 }] });
  await r.userSettings.put(M, 0, { personalCategories: [{ id: "beauty", name: "Красота", limit: 7000 }] });
  await r.expenses.add(V, ex("vlad", { id: "fe1" }));
  await r.expenses.add(V, ex("vlad", { id: "ve1", scope: "personal", catId: "hobby" }));
  await r.expenses.add(V, ex("vlad", { id: "ve2", scope: "personal", catId: "hobby" }));
  await r.incomes.add(V, inc("in1"));
  await r.planItems.create(V, item("fpi", "family", null));
  await r.planItems.create(V, item("vpi", "personal", "vlad"));
  await r.recurring.create(V, pay("frec", "family", null));
  await r.recurring.create(V, pay("vrec", "personal", "vlad"));
  await r.accounts.create(V, acc("facc", "family", null));
  await r.accounts.create(V, acc("vacc", "personal", "vlad"));
  await r.goals.create(V, goal("fgoal", "family", null));
  await r.goals.create(V, goal("vgoal", "personal", "vlad"));
  await r.plans.putFamily(V, CUR, 0, { month: CUR, incomeOverride: 1000, limitOverrides: {} });
  await r.plans.putMine(V, CUR, 0, { month: CUR, limitOverrides: { hobby: 1 } });
  await r.apiTokens.add(V, "vtok", token("Влад"));
  await r.push.save(V, sub("https://p/vlad"));
  await r.expenses.add(V, ex("vlad", { id: "fe2" }));
  await r.expenses.remove(V, "personal", CUR, "ve2"); // в корзине — для проверки «Вернуть»
  await r.expenses.remove(V, "family", CUR, "fe2");
}
/** Всё, что видно владельцу данных (Влад) — должно остаться неизменным после действий Маши и Ольги */
async function state(r) {
  const raw = await r.store.snapshot(V);
  // Маша вправе менять своё личное — сравниваются семейные данные и личное Влада
  delete raw.userSettings.masha;
  for (const k of Object.keys(raw.hashes)) if (k.startsWith("ft:u:masha:")) delete raw.hashes[k];
  for (const o of [raw.savings.userAccounts, raw.savings.userGoals, raw.plans.byUser, raw.plans.userItems, raw.recurring.byUser]) delete o.masha;
  return { raw: canon(raw), tokens: await r.apiTokens.list(V), push: await r.push.has(V, "https://p/vlad") };
}

for (const name of Object.keys(IMPLS)) {
  const covered = new Set();
  let r, s0;
  test(`изоляция ${name}: подготовка`, async () => {
    const real = await IMPLS[name]();
    await seed(real);
    s0 = await state(real);
    r = { real, x: spy(real, covered) };
  });

  test(`изоляция ${name}: чтение`, async () => {
    const { x } = r;
    // Чужой бюджет: ничего из бюджета Влада
    for (const [label, res] of [
      ["settings.get", await attempt(() => x.settings.get(O))],
      ["userSettings.get", await attempt(() => x.userSettings.get(O))],
      ["expenses.inMonth", await attempt(() => x.expenses.inMonth(O, "family", CUR))],
      ["planItems.get", await attempt(() => x.planItems.get(O, "family", CUR, "fpi"))],
      ["recurring.get", await attempt(() => x.recurring.get(O, "family", "frec"))],
      ["apiTokens.list", await attempt(() => x.apiTokens.list(O))],
      ["push.has", await attempt(() => x.push.has(O, "https://p/vlad"))],
      ["legacy.docs", await attempt(() => x.legacy.docs(O))],
      ["legacy.hasDocs", await attempt(() => x.legacy.hasDocs(O))],
    ]) assert.ok(res === "denied" || res === null || res === false || (typeof res === "object" && !Object.keys(res).length) || (Array.isArray(res) && !res.length), `${label}: ${JSON.stringify(res)}`);
    const cats = await attempt(() => x.categories.list(O));
    assert.ok(cats === "denied" || (!cats.family.length && !cats.mine.length), "categories.list чужого бюджета");
    const snap = await attempt(() => x.store.snapshot(O));
    assert.ok(snap === "denied" || !JSON.stringify(snap).match(/fe1|ve1|fpi|facc|fgoal|frec|Хобби|Дом/), "store.snapshot чужого бюджета");

    // Личное партнёра в своём бюджете
    assert.equal((await x.userSettings.get(M)).personalCategories.some((c) => c.id === "hobby"), false, "userSettings.get");
    assert.deepEqual((await x.categories.list(M)).mine.map((c) => c.id), ["beauty"], "categories.list");
    assert.deepEqual(await x.expenses.inMonth(M, "personal", CUR), [], "expenses.inMonth");
    assert.equal(await x.planItems.get(M, "personal", CUR, "vpi"), null, "planItems.get");
    assert.equal(await x.recurring.get(M, "personal", "vrec"), null, "recurring.get");
    assert.deepEqual(await x.apiTokens.list(M), {}, "apiTokens.list");
    assert.equal(await x.push.has(M, "https://p/vlad"), false, "push.has");
    assert.deepEqual(Object.keys(await x.system.tokensOf("masha")), [], "system.tokensOf");
    assert.deepEqual((await x.system.subscriptions(["masha"])).map((s) => s.subscription.endpoint), [], "system.subscriptions");
    assert.deepEqual((await x.system.members(O.householdId)).map((u) => u.id).filter((u) => u !== "olga"), [], "system.members чужого бюджета");
    assert.deepEqual((await x.system.members(H)).map((u) => u.id), ["vlad", "masha"], "system.members своего");
    assert.notEqual(await x.system.householdOf("olga"), H, "system.householdOf");
    assert.equal(await x.system.householdOf("masha"), H);
    // Снимок содержит личное партнёра только для расчётов: в ответе Маше — ни одной записи, имени или id Влада
    const view = JSON.stringify(buildView(await x.store.snapshot(M), users.masha, users.vlad, CUR));
    for (const secret of ["ve1", "vpi", "vrec", "vacc", "vgoal", "Хобби"]) assert.ok(!view.includes(`"${secret}"`), `buildView(snapshot) у Маши: ${secret}`);
  });

  test(`изоляция ${name}: запись`, async () => {
    const { x, real } = r;
    const ch = (o) => ({ ...o, name: "взлом" });
    // Чужой бюджет (Ольга) и личное партнёра (Маша): попытки изменить данные Влада
    await attempt(() => x.settings.put(O, 1, { ...settingsDoc, base: "XXX" }));
    await attempt(() => x.settings.merge(O, (s) => s && { ...s, base: "XXX" }));
    // Ольга — семейные записи чужого бюджета, Маша — личные записи Влада
    for (const who of [O, M]) {
      const scope = who === O ? "family" : "personal";
      const id = (fam, own) => (who === O ? fam : own);
      await attempt(() => x.userSettings.put(who, 1, { personalCategories: [{ id: "hobby", name: "взлом", limit: 0 }] }));
      await attempt(() => x.expenses.add(who, ex(who.userId, { id: id("fe1", "ve1"), scope, catId: "hobby", amount: 1 })));
      await attempt(() => x.expenses.addForPlan(who, ex(who.userId, { scope, catId: scope === "personal" ? "hobby" : "home", planItemId: id("fpi", "vpi") })));
      await attempt(() => x.expenses.addForRecurring(who, ex(who.userId, { scope, catId: scope === "personal" ? "hobby" : "home", recurringId: id("frec", "vrec"), recurringMonth: CUR })));
      await attempt(() => x.expenses.remove(who, scope, CUR, id("fe1", "ve1")));
      await attempt(() => x.trash.restore(who, "ve2"));
      await attempt(() => x.accounts.create(who, acc(id("facc", "vacc"), scope, who.userId)));
      await attempt(() => x.accounts.update(who, scope, id("facc", "vacc"), undefined, ch));
      await attempt(() => x.goals.create(who, goal(id("fgoal", "vgoal"), scope, who.userId)));
      await attempt(() => x.goals.update(who, scope, id("fgoal", "vgoal"), undefined, () => null));
      await attempt(() => x.planItems.create(who, item(id("fpi", "vpi"), scope, who.userId)));
      await attempt(() => x.planItems.update(who, scope, CUR, id("fpi", "vpi"), undefined, () => null));
      const target = item(id("fpi", "vpi"), scope, who === O ? null : "vlad");
      await attempt(() => x.planItems.move(who, target, { ...target, month: NEXT, version: 2 }));
      await attempt(() => x.recurring.create(who, pay(id("frec", "vrec"), scope, who.userId)));
      await attempt(() => x.recurring.update(who, scope, id("frec", "vrec"), undefined, ch));
      await attempt(() => x.plans.putMine(who, CUR, 1, { month: CUR, limitOverrides: { hobby: 999 } }));
      await attempt(() => x.apiTokens.remove(who, "vtok"));
      await attempt(() => x.push.remove(who, "https://p/vlad"));
      await attempt(() => x.system.touchToken(who.userId, "vtok", { ...token("взлом"), lastUsedAt: "2030-01-01T00:00:00.000Z" }));
    }
    // Семейную запись из корзины чужого бюджета вернуть нельзя (и её содержимое не возвращается)
    const back = await attempt(() => x.trash.restore(O, "fe2"));
    assert.ok(back === "denied" || !back.ok, `trash.restore чужого бюджета: ${JSON.stringify(back)}`);
    // Чужой бюджет: семейные документы, сверка, общие записи, перенос и замена хранилища
    await attempt(() => x.plans.putFamily(O, CUR, 1, { month: CUR, incomeOverride: 1, limitOverrides: {} }));
    await attempt(() => x.incomes.add(O, inc("in1", { authorId: "olga", amount: 1, base: 1 })));
    await attempt(() => x.incomes.remove(O, CUR, "in1"));
    const facc = (await real.store.snapshot(V)).savings.accounts.facc;
    await attempt(() => x.recons.add(O, recon("rx", "2026-10-21T00:00:00.000Z", {}), [], [{ ...facc, balance: 1, version: facc.version + 1 }], 0));
    // Маша не может сверкой изменить личный счёт Влада
    const vacc = (await real.store.snapshot(V)).savings.userAccounts.vlad.vacc;
    await attempt(() => x.recons.add(M, recon("ry", "2026-10-21T00:00:00.000Z", {}), [vacc], [{ ...vacc, balance: 1, version: vacc.version + 1 }], 0));
    await attempt(() => x.legacy.importGoals(O, [goal("fgoal", "family", null)]));
    await attempt(() => x.apiTokens.add(O, "otok", token("Ольга")));
    await attempt(() => x.push.save(O, sub("https://p/olga")));
    const raw = await real.store.snapshot(V);
    await attempt(() => x.store.replace(O, { ...raw, settings: { ...raw.settings, base: "XXX" } }));

    const s1 = await state(real);
    // Снимок Влада не изменился, кроме данных, которые чужие действия законно добавили себе
    assert.deepEqual(s1.tokens, s0.tokens, "токены Влада");
    assert.equal(s1.push, true, "подписка Влада");
    assert.deepEqual(s1.raw, s0.raw, "данные бюджета Влада");
  });

  test(`изоляция ${name}: каждый метод покрыт`, () => {
    const missing = methodsOf(r.real).filter((m) => !covered.has(m) && !EXEMPT[m]);
    assert.deepEqual(missing, [], `методы без проверки изоляции: ${missing.join(", ")}`);
  });
}
