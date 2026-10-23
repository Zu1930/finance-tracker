// Перенос Redis → Postgres: фейковый Upstash с данными через Redis-реализацию, перенос в PGlite, сверка.
// Запуск: npm run test
import { test, after } from "node:test";
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
const { getRedis } = await import("./redis/client.ts");
const { importToPostgres, readRedisSource, readPostgresSource, metrics, compare } = await import("./migrate.ts");
const schema = await import("./postgres/schema.ts");
after(() => fake.close());

const users = [{ id: "vlad", name: "Влад" }, { id: "masha", name: "Маша" }];
const V = { userId: "vlad", householdId: "default" }, M = { userId: "masha", householdId: "default" };
const T = "2026-10-20", CUR = "2026-10";
let n = 0;
const ex = (who, extra = {}) => ({ id: `x${++n}`, amount: 1000, currency: "RSD", rate: 1, base: 1000, catId: "food", note: "n", date: T, ts: 1_760_000_000_000 + n, scope: "family", authorId: who, ...extra });

async function seedRedis(extra = async () => {}) {
  fake.reset();
  n = 0;
  const r = redisRepos();
  await r.settings.put(V, 0, { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, schemaVersion: 3, familyCategories: [{ id: "home", name: "Дом", limit: 20000 }, { id: "food", name: "Еда", limit: 40000 }] });
  await r.userSettings.put(V, 0, { personalCategories: [{ id: "hobby", name: "Хобби", limit: 5000 }] });
  await r.userSettings.put(M, 0, { personalCategories: [{ id: "beauty", name: "Красота", limit: 7000 }], hideQuickEntry: true });
  await r.expenses.add(V, ex("vlad"));
  await r.expenses.add(M, ex("masha", { date: "2026-09-03" }));
  await r.expenses.add(V, ex("vlad", { scope: "personal", catId: "hobby", currency: "EUR", amount: 10, rate: 0.008547008547008548, base: 0.09 }));
  await r.expenses.add(M, ex("masha", { scope: "personal", catId: "beauty", base: 2500, amount: 2500 }));
  await r.incomes.add(V, { id: "i1", amount: 1000, currency: "EUR", rate: 117.25, base: 117250, sourceId: "salary", note: "", date: T, ts: 1, authorId: "vlad" });
  await r.planItems.create(V, { id: "pi", month: CUR, name: "Пылесос", amount: 25000, categoryId: "home", scope: "family", createdBy: "vlad", expenseIds: [], version: 1 });
  await r.expenses.addForPlan(M, ex("masha", { catId: "home", amount: 26000, base: 26000, planItemId: "pi" }));
  await r.planItems.create(M, { id: "mpi", month: "2026-11", name: "Крем", amount: 3000, categoryId: "beauty", scope: "personal", ownerId: "masha", createdBy: "masha", expenseIds: [], version: 1 });
  await r.recurring.create(V, { id: "rent", name: "Аренда", currency: "EUR", approx: false, frequency: "monthly", day: 1, categoryId: "home", scope: "family", startMonth: "2026-09", paused: false, skips: ["2026-12"], amounts: [{ fromMonth: "2026-09", amount: 500 }, { fromMonth: "2026-11", amount: 550 }], createdBy: "vlad", version: 1 });
  await r.recurring.create(M, { id: "year", name: "Год", currency: "EUR", approx: false, frequency: "yearly", month: 3, day: 5, categoryId: "beauty", scope: "personal", ownerId: "masha", startMonth: CUR, paused: false, skips: [], amounts: [{ fromMonth: CUR, amount: 30 }], createdBy: "masha", version: 1 });
  await r.expenses.addForRecurring(V, ex("vlad", { catId: "home", amount: 500, currency: "EUR", rate: 117, base: 58500, recurringId: "rent", recurringMonth: CUR }));
  await r.accounts.create(V, { id: "facc", name: "Общий", currency: "RSD", scope: "family", balance: 100000, initial: 100000, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "vlad", version: 1 });
  await r.accounts.create(M, { id: "macc", name: "Мой", currency: "EUR", scope: "personal", ownerId: "masha", balance: 500.5, initial: 500.5, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "masha", version: 1 });
  await r.goals.create(M, { id: "car", name: "Машина", target: 5000, currency: "EUR", allocated: 300, scope: "family", ops: [{ id: "o1", amount: 300, date: T, ts: 5, by: "masha" }], version: 1 });
  const snap = await r.store.snapshot(V);
  const facc = snap.savings.accounts.facc;
  await r.recons.add(V, { id: "r1", at: "2026-10-20T10:00:00.000Z", day: T, by: "vlad", balances: { facc: 90000, macc: 500.5 }, rates: { EUR: 117 }, totals: { family: 90000, byUser: { vlad: 0, masha: 58558.5 }, all: 148558.5 }, income: null, expense: null, expected: null, fact: null, gap: null },
    Object.values(snap.savings.accounts).concat(Object.values(snap.savings.userAccounts.masha)), [{ ...facc, balance: 90000, version: 2 }], 0);
  await r.plans.putFamily(V, "2026-11", 0, { month: "2026-11", incomeOverride: 280000, limitOverrides: { home: 30000 } });
  await r.plans.putMine(M, "2026-11", 0, { month: "2026-11", limitOverrides: { beauty: 9000 } });
  await r.apiTokens.add(V, "t1", { name: "iPhone", hash: "a".repeat(64), createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: "2026-10-02T10:00:00.000Z" });
  await r.push.save(M, { endpoint: "https://p/m", keys: { p256dh: "p", auth: "a" } });
  await r.system.swapAppVersion("abc123");
  // Старый формат и неиндексированный ключ: не переносятся и не меняются
  await getRedis().set("ft:doc:settings", { categories: [] });
  await getRedis().hset("ft:m:2020-01", { lost: ex("vlad", { date: "2020-01-01" }) });
  await extra(r);
}

async function freshPg() {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return db;
}
const verify = async (db) => compare(metrics(await readRedisSource(users), users), metrics(await readPostgresSource(db, users), users));

test("перенос: пробный ничего не пишет, настоящий даёт 0 расхождений, повтор ничего не задваивает", async () => {
  await seedRedis();
  const before = await readRedisSource(users);
  const db = await freshPg();

  const dry = await importToPostgres(db, before, users, { dryRun: true });
  assert.equal(dry.counts.expenses, 6);
  assert.deepEqual(await db.select().from(schema.expenses), [], "после --dry-run в Postgres пусто");
  assert.deepEqual(await db.select().from(schema.households), []);

  const res = await importToPostgres(db, before, users);
  assert.deepEqual(res.counts, dry.counts);
  assert.match(res.skipped.join("\n"), /ft:m:2020-01: нет в ft:index/);
  const rows = await verify(db);
  assert.deepEqual(rows.filter((r) => !r.ok), [], "расхождения после переноса");
  assert.ok(rows.length > 25, `показателей: ${rows.length}`);
  assert.ok(rows.some((r) => r.metric === "ответ /api/data для masha" && r.ok));

  const memberships = await db.select().from(schema.memberships);
  assert.deepEqual(memberships.map((x) => [x.userId, x.role]).sort(), [["masha", "member"], ["vlad", "owner"]]);
  const [rate] = await db.select({ rate: schema.expenses.rate }).from(schema.expenses).where((await import("drizzle-orm")).eq(schema.expenses.currency, "EUR")).limit(1);
  assert.ok(rate, "трата в EUR перенесена");

  // Повтор: те же строки, без дублей, сверка по-прежнему чистая
  await importToPostgres(db, await readRedisSource(users), users);
  assert.equal((await db.select().from(schema.expenses)).length, 6);
  assert.equal((await db.select().from(schema.goalOps)).length, 1);
  assert.deepEqual((await verify(db)).filter((r) => !r.ok), []);

  // Redis не изменился, старый формат на месте
  assert.deepEqual(await readRedisSource(users), before);
  assert.ok(await getRedis().exists("ft:doc:settings"));
});

test("повторный перенос после переключения: отказ, если в Postgres есть данные новее Redis", async () => {
  await seedRedis();
  const db = await freshPg();
  await importToPostgres(db, await readRedisSource(users), users);
  const { postgresRepos } = await import("./postgres/repos.ts");
  const pg = postgresRepos(db);
  // Приложение уже работает на Postgres: новая трата и изменённый счёт
  await pg.expenses.add(V, ex("vlad", { id: "after-cutover" }));
  await pg.accounts.update(V, "family", "facc", undefined, (a) => ({ ...a, name: "Новое имя" }));
  await assert.rejects(importToPostgres(db, await readRedisSource(users), users), (e) => /новее Redis \(2\)/.test(e.message) && /after-cutover: нет в Redis/.test(e.message) && /счёт facc: версия 3 > 2/.test(e.message));
  assert.equal((await pg.store.snapshot(V)).savings.accounts.facc.name, "Новое имя", "ничего не перезаписано");
  // --force — осознанная перезапись
  await importToPostgres(db, await readRedisSource(users), users, { force: true });
  assert.equal((await pg.store.snapshot(V)).savings.accounts.facc.name, "Общий");
});

test("сверка ловит расхождение суммы, остатка и лишнюю запись", async () => {
  await seedRedis();
  const db = await freshPg();
  await importToPostgres(db, await readRedisSource(users), users);
  const { eq } = await import("drizzle-orm");
  await db.update(schema.expenses).set({ base: 999 }).where(eq(schema.expenses.id, "x1"));
  await db.update(schema.accounts).set({ balance: 1 }).where(eq(schema.accounts.id, "facc"));
  await db.insert(schema.incomes).values({ householdId: "default", id: "extra", authorId: "masha", sourceId: "salary", amount: 1, currency: "RSD", rate: 1, base: 1, date: T, ts: new Date() });
  const bad = (await verify(db)).filter((r) => !r.ok).map((r) => r.metric);
  for (const m of [`Σ base траты ${CUR} family vlad`, "остаток счёта facc", "записей: доходы", "ответ /api/data для vlad"]) assert.ok(bad.includes(m), `нет расхождения «${m}»: ${bad.join(", ")}`);
});

test("отказ: суммы с тремя знаками, старые копилки не перенесены, данные старого формата", async () => {
  await seedRedis((r) => r.expenses.add(V, ex("vlad", { amount: 10.555 })));
  await assert.rejects(importToPostgres(await freshPg(), await readRedisSource(users), users), /2 знаками/);

  await seedRedis(async (r) => {
    await getRedis().set("ft:goals", { items: [{ id: "g", name: "Старая", target: 1, ops: [] }], version: 1 });
    await r.settings.merge(V, (s) => ({ ...s, schemaVersion: 2 }));
  });
  await assert.rejects(readRedisSource(users), /migrate-v3/);

  fake.reset();
  await getRedis().set("ft:doc:settings", { categories: [] });
  await assert.rejects(readRedisSource(users), /migrate-v2/);
});
