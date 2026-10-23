// Семья и приглашения: перенос личных данных приглашённого, пересчёт валюты, одинаковый отказ на плохой код,
// изоляция: партнёр не видит перенесённое, чужие приглашения недоступны. Запуск: npm run test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test/auth-kit.mjs";

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { buildView } = await import("./store.ts");
const { createInvite, revokeInvite, previewInvite, acceptInvite, familyInfo, INVALID, MAX_MEMBERS } = await import("./family.ts");
const { eq } = await import("drizzle-orm");

const T = "2026-10-20", CUR = "2026-10";
let db, sql, r, n = 0;
const ex = (who, extra = {}) => ({ id: `x${++n}-${who}`, amount: 1000, currency: "RSD", rate: 1, base: 1000, catId: "c-" + who, note: "секрет-" + who, date: T, ts: 1_760_000_000_000 + n, scope: "personal", authorId: who, ...extra });

beforeEach(async () => {
  ({ db, sql } = await freshDb(schema));
  r = postgresRepos(db);
  await sql(`INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга'), ('petr', 'Пётр')`);
});

/** solo-бюджет пользователя с настройками и личными данными всех видов */
async function soloWith(who, base) {
  const ctx = { userId: who, householdId: await r.system.ensureHousehold(who) };
  await r.settings.put(ctx, 0, { base, currencies: [base, "USD"], rates: { USD: base === "EUR" ? 0.9 : 105 }, schemaVersion: 3, familyCategories: [] });
  await r.userSettings.put(ctx, 0, { personalCategories: [{ id: "c-" + who, name: "Кат-" + who, limit: base === "EUR" ? 100 : 12000 }] });
  await r.expenses.add(ctx, ex(who, { currency: base, base: 50, amount: 50 }));
  await r.expenses.add(ctx, ex(who, { currency: "USD", amount: 10, rate: base === "EUR" ? 0.9 : 105, base: base === "EUR" ? 9 : 1050 }));
  await r.recurring.create(ctx, { id: "rec-" + who, name: "Подписка-" + who, currency: base, approx: false, frequency: "monthly", day: 5, categoryId: "c-" + who, scope: "personal", ownerId: who, startMonth: CUR, paused: false, skips: [], amounts: [{ fromMonth: CUR, amount: 10 }], createdBy: who, version: 1 });
  await r.expenses.addForRecurring(ctx, ex(who, { currency: base, amount: 10, base: 10, recurringId: "rec-" + who, recurringMonth: CUR }));
  await r.accounts.create(ctx, { id: "acc-" + who, name: "Счёт-" + who, currency: base, scope: "personal", ownerId: who, balance: 500, initial: 500, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: who, version: 1 });
  await r.goals.create(ctx, { id: "goal-" + who, name: "Копилка-" + who, target: 1000, currency: base, allocated: 100, scope: "personal", ownerId: who, ops: [{ id: "op-" + who, amount: 100, date: T, ts: 1, by: who }], version: 1 });
  await r.planItems.create(ctx, { id: "pi-" + who, month: CUR, name: "Покупка-" + who, amount: 30, categoryId: "c-" + who, scope: "personal", ownerId: who, createdBy: who, expenseIds: [], version: 1 });
  await r.plans.putMine(ctx, CUR, 0, { month: CUR, limitOverrides: { ["c-" + who]: 1 } });
  await r.plans.putFamily(ctx, CUR, 0, { month: CUR, incomeOverride: 99999, limitOverrides: {} });
  await r.incomes.add(ctx, { id: "inc-" + who, amount: 7000, currency: base, rate: 1, base: 7000, sourceId: "salary", note: "", date: T, ts: 1, authorId: who });
  return ctx;
}
const ctxOf = async (who) => ({ userId: who, householdId: await r.system.householdOf(who) });
const viewOf = async (who) => {
  const ctx = await ctxOf(who);
  const list = await r.system.members(ctx.householdId);
  return buildView(await r.store.snapshot(ctx), list.find((u) => u.id === who), list.find((u) => u.id !== who) ?? null, CUR);
};
const rows = async (table, householdId) => db.select().from(table).where(eq(table.householdId, householdId));

test("приглашение из solo: принятие переносит личное приглашённого, партнёр видит только суммы, solo удалён", async () => {
  const v = await soloWith("vlad", "RSD");
  const m = await soloWith("masha", "RSD");
  const { code } = await createInvite(db, v);
  assert.deepEqual(await previewInvite(db, code, "masha"), { ok: true, inviter: "Влад", members: 1, base: "RSD", myBase: "RSD", needsRate: false });
  assert.deepEqual(await acceptInvite(db, code, "masha"), { ok: true, householdId: v.householdId });

  // Семья: kind=family, оба действующие; solo Маши удалён со всем, что не переехало
  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, v.householdId));
  assert.equal(h.kind, "family");
  assert.deepEqual((await r.system.members(v.householdId)).map((u) => u.id), ["vlad", "masha"]);
  assert.equal((await db.select().from(schema.households).where(eq(schema.households.id, m.householdId))).length, 0);
  for (const t of [schema.expenses, schema.incomes, schema.accounts, schema.goals, schema.categories, schema.recurringPayments, schema.planItems, schema.monthPlans]) {
    assert.equal((await rows(t, m.householdId)).length, 0, "в старом бюджете ничего не осталось");
  }

  // У Маши — всё её личное, с теми же id
  const mv = await viewOf("masha");
  assert.equal(mv.solo, undefined);
  assert.equal(mv.partner.id, "vlad");
  assert.deepEqual(mv.myExpenses[CUR].map((e) => e.scope), ["personal", "personal", "personal"]);
  assert.ok(mv.myExpenses[CUR].every((e) => e.authorId === "masha"));
  assert.deepEqual(mv.mySettings.personalCategories.map((c) => c.id), ["c-masha"]);
  assert.deepEqual(mv.savings.accounts.mine.map((a) => a.id), ["acc-masha"]);
  assert.deepEqual(mv.savings.goals.mine.map((g) => [g.id, g.ops.length]), [["goal-masha", 1]]);
  assert.deepEqual(mv.recurring.mine.map((p) => [p.id, p.amounts.length]), [["rec-masha", 1]]);
  assert.deepEqual(mv.plans[CUR].items.mine.map((i) => i.id), ["pi-masha"]);
  assert.deepEqual(mv.plans[CUR].myOverrides, { "c-masha": 1 });
  assert.ok(mv.myExpenses[CUR].some((e) => e.recurringId === "rec-masha"), "оплата регулярного переехала вместе с платежом");
  // Доходы, план дохода solo — не переезжают (доходы в семье видны всем)
  assert.equal((mv.incomes[CUR] ?? []).filter((i) => i.authorId === "masha").length, 0);
  assert.equal(mv.plans[CUR].incomeOverride, 99999, "план дохода семьи — Влада, не Маши");

  // Влад: ни одной записи, имени категории, заметки или счёта Маши — только суммы
  const vv = await viewOf("vlad");
  const seen = JSON.stringify(vv);
  for (const secret of ["секрет-masha", "Кат-masha", "Счёт-masha", "Копилка-masha", "Покупка-masha", "Подписка-masha", "x1-masha", "acc-masha"]) assert.ok(!seen.includes(secret), `Влад видит ${secret}`);
  assert.equal(vv.partnerPersonalTotals[CUR], 1110, "только сумма за месяц");
  assert.equal(vv.partner.id, "masha");
});

test("разные базовые валюты: без курса — отказ, с курсом — пересчёт тем же механизмом, что смена базы", async () => {
  const v = await soloWith("vlad", "RSD");
  await soloWith("masha", "EUR");
  const { code } = await createInvite(db, v);
  const p = await previewInvite(db, code, "masha");
  assert.deepEqual([p.base, p.myBase, p.needsRate], ["RSD", "EUR", true]);
  const no = await acceptInvite(db, code, "masha");
  assert.equal(no.status, 400);
  assert.equal((await r.system.members(v.householdId)).length, 1, "без курса ничего не произошло");
  // 1 RSD = 0.0085 EUR
  assert.equal((await acceptInvite(db, code, "masha", 0.0085)).ok, true);
  const mv = await viewOf("masha");
  const eur = mv.myExpenses[CUR].find((e) => e.currency === "EUR" && !e.recurringId);
  assert.equal(eur.amount, 50, "сумма в валюте записи не меняется");
  assert.equal(eur.base, Math.round((50 / 0.0085) * 100) / 100, "в базе семьи");
  assert.equal(mv.mySettings.personalCategories[0].limit, Math.round((100 / 0.0085) * 100) / 100, "личные лимиты пересчитаны");
  const settings = await r.settings.get(await ctxOf("vlad"));
  assert.equal(settings.base, "RSD");
  assert.ok(settings.currencies.includes("EUR"), "валюта Маши в списке семьи");
});

test("плохой код: неизвестный, использованный, отозванный, истёкший — один ответ «приглашение недействительно»", async () => {
  const v = await soloWith("vlad", "RSD");
  await r.system.ensureHousehold("masha"), await r.system.ensureHousehold("olga"), await r.system.ensureHousehold("petr");
  const used = (await createInvite(db, v)).code;
  assert.equal((await acceptInvite(db, used, "masha")).ok, true);
  const revoked = await createInvite(db, v);
  assert.equal(await revokeInvite(db, v, revoked.invite.id), true);
  const expired = await createInvite(db, v);
  await db.update(schema.householdInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.householdInvites.id, expired.invite.id));
  const answers = [];
  for (const code of ["нет-такого-кода-12345", used, revoked.code, expired.code]) {
    answers.push(JSON.stringify(await previewInvite(db, code, "olga")), JSON.stringify(await acceptInvite(db, code, "olga")));
  }
  assert.equal(new Set(answers).size, 1, answers.join("\n"));
  assert.deepEqual(JSON.parse(answers[0]), { ok: false, status: 404, error: INVALID });
  assert.equal((await r.system.members(v.householdId)).length, 2, "Ольга не вошла");
});

test("приглашённый уже в семье — отказ; участник по своей ссылке — недействительно; семья не больше 6", async () => {
  const v = await soloWith("vlad", "RSD");
  await r.system.ensureHousehold("masha");
  assert.equal((await acceptInvite(db, (await createInvite(db, v)).code, "masha")).ok, true);
  // У Ольги своя семья с Петром
  const o = { userId: "olga", householdId: await r.system.ensureHousehold("olga") };
  await r.system.ensureHousehold("petr");
  assert.equal((await acceptInvite(db, (await createInvite(db, o)).code, "petr")).ok, true);
  const toOlga = (await createInvite(db, v)).code;
  const refused = await acceptInvite(db, toOlga, "olga");
  assert.equal(refused.status, 409);
  assert.match(refused.error, /сначала выйдите/);
  assert.equal((await previewInvite(db, toOlga, "olga")).status, 409);
  assert.equal((await acceptInvite(db, toOlga, "masha")).error, INVALID, "своя семья");
  // Лимит участников: 2 участника + 4 приглашения = 6, седьмое не создаётся
  for (let i = 0; i < MAX_MEMBERS - 2 - 1; i++) assert.equal((await createInvite(db, v)).ok, true);
  const full = await createInvite(db, v);
  assert.equal(full.status, 409);
});

test("семья из трёх: третий принимает, всё личное остаётся у каждого; чужие приглашения не отозвать и не увидеть", async () => {
  const v = await soloWith("vlad", "RSD");
  await soloWith("masha", "RSD");
  await soloWith("olga", "RSD");
  assert.equal((await acceptInvite(db, (await createInvite(db, v)).code, "masha")).ok, true);
  const third = await createInvite(db, await ctxOf("masha"));
  assert.equal((await acceptInvite(db, third.code, "olga")).ok, true);
  const info = await familyInfo(db, await ctxOf("vlad"));
  assert.deepEqual([info.kind, info.members.map((x) => x.id)], ["family", ["vlad", "masha", "olga"]]);
  for (const who of ["vlad", "masha"]) assert.ok(!JSON.stringify(await viewOf(who)).includes("секрет-olga"));
  assert.equal((await viewOf("olga")).myExpenses[CUR].length, 3);

  // Изоляция приглашений: другой бюджет не видит и не отзывает
  const p = { userId: "petr", householdId: await r.system.ensureHousehold("petr") };
  const mineInvite = await createInvite(db, await ctxOf("vlad"));
  assert.equal(await revokeInvite(db, p, mineInvite.invite.id), false);
  assert.equal((await familyInfo(db, p)).invites.length, 0);
  assert.equal((await familyInfo(db, await ctxOf("vlad"))).invites.length, 1);
  // Код в базе — только хешем
  const [row] = await db.select().from(schema.householdInvites).where(eq(schema.householdInvites.id, mineInvite.invite.id));
  assert.ok(!JSON.stringify(row).includes(mineInvite.code));
});
