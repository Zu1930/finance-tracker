// Выход из семьи, архив, разбор имущества, восстановление, очистка. Главное — приватность: после выхода никто
// не видит личного другого ни записями, ни суммами; архив — только семейное и только до даты выхода.
// Запуск: npm run test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test/auth-kit.mjs";

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { buildView } = await import("./store.ts");
const { createInvite, acceptInvite } = await import("./family.ts");
const A = await import("./archive.ts");
const { eq, and } = await import("drizzle-orm");

const T = "2026-10-20", CUR = "2026-10";
let db, sql, r, n = 0;
const ex = (who, scope, extra = {}) => ({ id: `x${++n}-${who}`, amount: 100, currency: "RSD", rate: 1, base: 100, catId: scope === "family" ? "food" : "c-" + who, note: `${scope}-${who}`, date: T, ts: 1_760_000_000_000 + n, scope, authorId: who, ...extra });
const ctxOf = async (who) => ({ userId: who, householdId: await r.system.householdOf(who) });

beforeEach(async () => {
  ({ db, sql } = await freshDb(schema));
  r = postgresRepos(db);
  n = 0;
  await sql(`INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга'), ('petr', 'Пётр')`);
});

/** Семья из who[0] (owner) и остальных: семейные данные и личные данные каждого */
async function family(...who) {
  const v = { userId: who[0], householdId: await r.system.ensureHousehold(who[0]) };
  await r.settings.put(v, 0, { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 40000 }, { id: "home", name: "Дом", limit: 20000 }] });
  for (const u of who.slice(1)) {
    await r.system.ensureHousehold(u);
    assert.equal((await acceptInvite(db, (await createInvite(db, v)).code, u)).ok, true);
  }
  await r.accounts.create(v, { id: "facc", name: "Общий счёт", currency: "RSD", scope: "family", balance: 100000, initial: 100000, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: who[0], version: 1 });
  await r.goals.create(v, { id: "fgoal", name: "Отпуск", target: 2000, currency: "EUR", allocated: 300, scope: "family", ops: [{ id: "op1", amount: 300, date: T, ts: 1, by: who[0] }], version: 1 });
  await r.recurring.create(v, { id: "rent", name: "Аренда", currency: "EUR", approx: false, frequency: "monthly", day: 1, categoryId: "home", scope: "family", startMonth: CUR, paused: false, skips: [], amounts: [{ fromMonth: CUR, amount: 500 }], createdBy: who[0], version: 1 });
  for (const u of who) {
    const c = await ctxOf(u);
    await r.userSettings.put(c, 0, { personalCategories: [{ id: "c-" + u, name: "Личное-" + u, limit: 5000 }] });
    await r.expenses.add(c, ex(u, "family"));
    await r.expenses.add(c, ex(u, "personal"));
    await r.incomes.add(c, { id: "inc-" + u, amount: 50000, currency: "RSD", rate: 1, base: 50000, sourceId: "salary", note: "доход-" + u, date: T, ts: 1, authorId: u });
    await r.accounts.create(c, { id: "acc-" + u, name: "Мой счёт-" + u, currency: "RSD", scope: "personal", ownerId: u, balance: 777, initial: 777, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: u, version: 1 });
    await r.goals.create(c, { id: "goal-" + u, name: "Моя копилка-" + u, target: 10, currency: "RSD", allocated: 0, scope: "personal", ownerId: u, ops: [], version: 1 });
    await r.recurring.create(c, { id: "rec-" + u, name: "Мой платёж-" + u, currency: "RSD", approx: false, frequency: "monthly", day: 3, categoryId: "c-" + u, scope: "personal", ownerId: u, startMonth: CUR, paused: false, skips: [], amounts: [{ fromMonth: CUR, amount: 100 }], createdBy: u, version: 1 });
    await r.planItems.create(c, { id: "pi-" + u, month: CUR, name: "Моя покупка-" + u, amount: 10, categoryId: "c-" + u, scope: "personal", ownerId: u, createdBy: u, expenseIds: [], version: 1 });
    await r.plans.putMine(c, CUR, 0, { month: CUR, limitOverrides: { ["c-" + u]: 1 } });
  }
  return v.householdId;
}
const viewOf = async (who) => {
  const c = await ctxOf(who);
  const list = await r.system.members(c.householdId);
  return buildView(await r.store.snapshot(c), list.find((u) => u.id === who), list.find((u) => u.id !== who) ?? null, CUR);
};
const PRIVATE = (u) => [`personal-${u}`, `Личное-${u}`, `Мой счёт-${u}`, `Моя копилка-${u}`, `Мой платёж-${u}`, `Моя покупка-${u}`, `доход-${u}`];

test("выход из пары: семья в архиве на 90 дней, у обоих solo с их личным, семейное — только в архиве", async () => {
  const F = await family("vlad", "masha");
  const res = await A.leaveFamily(db, "masha");
  assert.deepEqual(res, { ok: true, householdId: F, dissolved: true });

  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, F));
  assert.equal(h.status, "archived");
  assert.ok(Math.abs(h.purgeAt - Date.now() - 90 * 86_400_000) < 60_000, "purge_at = +90 дней");
  const ms = await db.select().from(schema.memberships).where(eq(schema.memberships.householdId, F));
  assert.deepEqual(ms.map((m) => [m.status, m.readonlyUntil?.getTime()]), ms.map(() => ["former", h.purgeAt.getTime()]));

  for (const [me, other] of [["vlad", "masha"], ["masha", "vlad"]]) {
    const c = await ctxOf(me);
    assert.notEqual(c.householdId, F, "действующий бюджет — новый solo");
    const v = await viewOf(me);
    assert.equal(v.solo, true);
    assert.deepEqual(v.myExpenses[CUR].map((e) => e.note), [`personal-${me}`]);
    assert.deepEqual(Object.values(v.familyExpenses).flat(), [], "семейных трат в solo нет");
    assert.deepEqual(v.incomes[CUR].map((i) => i.note), [`доход-${me}`], "свои доходы переехали");
    assert.deepEqual(v.savings.accounts.mine.map((a) => a.id), [`acc-${me}`]);
    assert.deepEqual(v.savings.accounts.family, []);
    assert.deepEqual(v.savings.goals.mine.map((g) => g.id), [`goal-${me}`]);
    assert.deepEqual(v.recurring.mine.map((p) => p.id), [`rec-${me}`]);
    assert.deepEqual(v.plans[CUR].items.mine.map((i) => i.id), [`pi-${me}`]);
    assert.deepEqual(v.mySettings.personalCategories.map((c) => c.id), [`c-${me}`]);
    assert.equal(v.settings.base, "RSD", "валюты — как в семье");
    const seen = JSON.stringify(v);
    for (const p of PRIVATE(other)) assert.ok(!seen.includes(p), `${me} видит ${p}`);

    // Архив: семейное, без личного обоих и без сумм по людям; только чтение — своего бюджета у архива нет
    const a = await A.archiveView(db, me, F);
    assert.equal(a.readonly.householdId, F);
    assert.equal(a.partner, null);
    assert.equal(a.solo, undefined, "архив показывает семейные разделы");
    assert.deepEqual(a.familyExpenses[CUR].map((e) => e.note).sort(), ["family-masha", "family-vlad"]);
    assert.deepEqual(a.myExpenses, {});
    assert.deepEqual(a.partnerPersonalTotals, {});
    assert.deepEqual(a.savings.accounts.family.map((x) => x.id), ["facc"]);
    assert.deepEqual(a.names, { vlad: "Влад", masha: "Маша" });
    const arch = JSON.stringify(a);
    for (const p of [...PRIVATE("vlad"), ...PRIVATE("masha")]) assert.ok(!arch.includes(p), `в архиве ${p}`);
    await assert.rejects(r.store.snapshot({ userId: me, householdId: F }), /не участник/, "архив не открывается как действующий бюджет");
  }
  assert.equal((await A.leaveFamily(db, "vlad")).status, 409, "из solo выходить некуда");
});

test("выход из семьи из трёх: семья работает, ушедший видит архив только до даты выхода, его данных не видно никому", async () => {
  const F = await family("vlad", "masha", "olga");
  assert.deepEqual(await A.leavePreview(db, "olga"), { ok: true, dissolves: false, others: ["Влад", "Маша"] });
  assert.equal((await A.leaveFamily(db, "olga")).dissolved, false);
  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, F));
  assert.equal(h.status, "active");
  assert.deepEqual((await r.system.members(F)).map((u) => u.id), ["vlad", "masha"]);

  // Новое в семье после выхода
  await new Promise((ok) => setTimeout(ok, 5));
  const later = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await r.expenses.add(await ctxOf("vlad"), ex("vlad", "family", { note: "после-выхода", date: later }));

  for (const who of ["vlad", "masha"]) {
    const seen = JSON.stringify(await viewOf(who));
    for (const p of PRIVATE("olga")) assert.ok(!seen.includes(p), `${who} видит ${p}`);
    assert.ok(seen.includes("family-olga"), "семейные траты Ольги остались семейными");
  }
  const a = await A.archiveView(db, "olga", F);
  const arch = JSON.stringify(a);
  assert.ok(!arch.includes("после-выхода"), "ничего нового после выхода");
  assert.ok(arch.includes("family-vlad"), JSON.stringify({ fe: a.familyExpenses, leftAt: a.readonly.leftAt }));
  assert.deepEqual(a.savings.accounts.family, [], "текущие счета живой семьи в архив не попадают");
  assert.deepEqual(a.recurring.family, []);
  // Доходы остальных — общие данные семьи, Ольга видела их до выхода; личного остальных нет
  for (const p of [...PRIVATE("vlad"), ...PRIVATE("masha")].filter((x) => !x.startsWith("доход"))) assert.ok(!arch.includes(p), p);
  assert.ok(arch.includes("доход-vlad"));
  assert.equal(await A.archiveView(db, "vlad", F), null, "у действующих участников архива нет");
});

test("владелец ушёл из семьи из трёх — владельцем становится старший участник", async () => {
  const F = await family("vlad", "masha", "olga");
  await A.leaveFamily(db, "vlad");
  const ms = await db.select().from(schema.memberships).where(and(eq(schema.memberships.householdId, F), eq(schema.memberships.status, "active")));
  assert.deepEqual(ms.map((m) => [m.userId, m.role]).sort(), [["masha", "owner"], ["olga", "member"]]);
});

test("разбор: счёт и платёж забирает один — второй видит, кто забрал; копилка — копия с нулём; категории без дублей", async () => {
  const F = await family("vlad", "masha");
  await A.leaveFamily(db, "masha");
  assert.deepEqual(await A.pendingReview(db, "vlad"), { householdId: F, name: "Личный бюджет" }, "оставшийся увидит разбор при входе");

  assert.deepEqual(await A.claim(db, "masha", F, "account", "facc"), { ok: true });
  const second = await A.claim(db, "vlad", F, "account", "facc");
  assert.equal(second.status, 409);
  assert.match(second.error, /Маша/);
  assert.deepEqual(await A.claim(db, "vlad", F, "recurring", "rent"), { ok: true });
  assert.equal((await A.claim(db, "masha", F, "recurring", "rent")).status, 409);
  const rv = await A.reviewView(db, "vlad", F);
  assert.deepEqual(rv.accounts.map((a) => [a.id, a.claimedBy, a.mine]), [["facc", "Маша", false]]);
  assert.deepEqual(rv.recurring.map((p) => [p.id, p.claimedBy, p.mine]), [["rent", "Влад", true]]);

  const mv = await viewOf("masha");
  const copy = mv.savings.accounts.mine.find((a) => a.name === "Общий счёт");
  assert.deepEqual([copy.balance, copy.initial, copy.scope, copy.ownerId], [100000, 100000, "personal", "masha"]);
  const vv = await viewOf("vlad");
  assert.deepEqual(vv.recurring.mine.find((p) => p.name === "Аренда").amounts, [{ fromMonth: CUR, amount: 500 }], "с историей цены");

  assert.deepEqual(await A.copyGoal(db, "vlad", F, "fgoal"), { ok: true });
  const g = (await viewOf("vlad")).savings.goals.mine.find((x) => x.name === "Отпуск");
  assert.deepEqual([g.target, g.allocated, g.currency], [2000, 0, "EUR"]);

  // У Влада уже есть «еда» — вторая не появится
  const vc = await ctxOf("vlad");
  const us = await r.userSettings.get(vc);
  await r.userSettings.put(vc, us.version, { ...us, personalCategories: [...us.personalCategories, { id: "mine-food", name: "  ЕДА ", limit: 1 }], version: undefined });
  assert.deepEqual(await A.copyCategories(db, "vlad", F), { ok: true, added: 1 });
  assert.deepEqual(await A.copyCategories(db, "vlad", F), { ok: true, added: 0 }, "повтор ничего не добавляет");
  assert.deepEqual((await viewOf("vlad")).mySettings.personalCategories.map((c) => c.name), ["Личное-vlad", "  ЕДА ", "Дом"]);

  // Чужой (не участник) — ничего
  await r.system.ensureHousehold("petr");
  assert.equal(await A.archiveView(db, "petr", F), null);
  assert.equal((await A.claim(db, "petr", F, "recurring", "rent")).status, 404);
  assert.equal(await A.reviewView(db, "petr", F), null);
  assert.equal((await A.copyGoal(db, "petr", F, "fgoal")).status, 404);
  assert.equal(await A.markReviewed(db, "petr", F), false);
  assert.equal(await A.markReviewed(db, "vlad", F), true);
  assert.equal(await A.pendingReview(db, "vlad"), null);
});

test("восстановление: только когда подтвердили оба; неизменённые копии удаляются, изменённые остаются", async () => {
  const F = await family("vlad", "masha");
  await A.leaveFamily(db, "vlad");
  await A.claim(db, "vlad", F, "account", "facc");
  await A.claim(db, "masha", F, "recurring", "rent");
  // Маша после роспуска меняет забранный платёж и вносит новую трату в solo
  const mc = await ctxOf("masha");
  const rec = (await viewOf("masha")).recurring.mine.find((p) => p.name === "Аренда");
  await r.recurring.update(mc, "personal", rec.id, undefined, (p) => ({ ...p, name: "Аренда (моя)" }));
  await r.expenses.add(mc, ex("masha", "personal", { note: "в-solo-masha" }));

  assert.deepEqual(await A.requestRestore(db, "vlad", F), { ok: true, restored: false, waiting: 1 });
  assert.equal((await db.select().from(schema.households).where(eq(schema.households.id, F)))[0].status, "archived", "одного согласия мало");
  const done = await A.requestRestore(db, "masha", F);
  assert.equal(done.restored, true);
  assert.deepEqual(done.kept.find((k) => k.userId === "masha").names, ["Аренда (моя)"]);
  assert.deepEqual(done.kept.find((k) => k.userId === "vlad").names, []);

  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, F));
  assert.deepEqual([h.status, h.purgeAt], ["active", null]);
  assert.deepEqual((await r.system.members(F)).map((u) => u.id).sort(), ["masha", "vlad"]);
  assert.equal((await ctxOf("vlad")).householdId, F);
  assert.equal((await db.select().from(schema.households).where(eq(schema.households.kind, "solo"))).length, 0, "solo удалены");
  const mv = await viewOf("masha");
  assert.ok(mv.myExpenses[CUR].some((e) => e.note === "в-solo-masha"), "новое из solo вернулось личным");
  assert.ok(mv.recurring.mine.some((p) => p.name === "Аренда (моя)"), "изменённая копия осталась");
  const vv = await viewOf("vlad");
  assert.ok(!vv.savings.accounts.mine.some((a) => a.name === "Общий счёт"), "неизменённая копия удалена");
  assert.deepEqual(vv.savings.accounts.family.map((a) => a.id), ["facc"]);
  assert.equal(vv.partner.id, "masha");
  // Доходы в семье видны всем — как до роспуска; остальное личное Маши — нет
  for (const p of PRIVATE("masha").filter((x) => !x.startsWith("доход"))) assert.ok(!JSON.stringify(vv).includes(p), `после восстановления Влад видит ${p}`);
  assert.equal((await db.select().from(schema.claims)).length, 0);
});

test("восстановление недоступно: после purge_at и если кто-то уже в другой семье", async () => {
  const F = await family("vlad", "masha");
  await A.leaveFamily(db, "masha");
  // Маша вступила в семью Петра
  const p = { userId: "petr", householdId: await r.system.ensureHousehold("petr") };
  assert.equal((await acceptInvite(db, (await createInvite(db, p)).code, "masha")).ok, true);
  const no = await A.requestRestore(db, "vlad", F);
  assert.equal(no.status, 409);
  assert.match(no.error, /другой семье/);

  await db.update(schema.households).set({ purgeAt: new Date(Date.now() - 1000) }).where(eq(schema.households.id, F));
  assert.equal((await A.requestRestore(db, "vlad", F)).status, 409);
});

test("очистка: распущенные с purge_at в прошлом удаляются каскадом, остальное не трогается", async () => {
  const F = await family("vlad", "masha");
  await A.leaveFamily(db, "masha");
  assert.deepEqual(await A.purgeExpired(db), [], "срок не вышел");
  await db.update(schema.households).set({ purgeAt: new Date(Date.now() - 1000) }).where(eq(schema.households.id, F));
  assert.deepEqual(await A.purgeExpired(db), [F]);
  for (const t of [schema.households, schema.memberships, schema.expenses, schema.accounts, schema.goals, schema.goalOps, schema.recurringPayments, schema.recurringAmounts, schema.categories, schema.claims]) {
    const left = await db.select().from(t).where(eq(t.householdId ?? t.id, F));
    assert.equal(left.length, 0, `осталось в ${t[Symbol.for("drizzle:Name")]}`);
  }
  assert.ok((await viewOf("vlad")).myExpenses[CUR].length === 1, "solo не тронут");
  assert.deepEqual(await A.archives(db, "vlad"), []);
});

test("архив: список с датами и сроком; после readonly_until — недоступен", async () => {
  const F = await family("vlad", "masha");
  await A.leaveFamily(db, "vlad");
  const [item] = await A.archives(db, "masha");
  assert.equal(item.householdId, F);
  assert.equal(item.dissolved, true);
  assert.deepEqual(item.restore, { requested: false, waiting: ["Влад"], askedBy: [] });
  await A.requestRestore(db, "vlad", F);
  assert.deepEqual((await A.archives(db, "masha"))[0].restore, { requested: false, waiting: [], askedBy: ["Влад"] }, "второй видит запрос");
  await db.update(schema.memberships).set({ readonlyUntil: new Date(Date.now() - 1000) }).where(eq(schema.memberships.householdId, F));
  assert.equal(await A.archiveView(db, "masha", F), null);
  assert.deepEqual(await A.archives(db, "masha"), []);
});
