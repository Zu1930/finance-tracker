// Тесты сбережений: цели и счета в ответе, приватность, смена базы для снимков истории. Журнал — lib/ledger.test.mjs.
// Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalDeleteError, prepareAccount, rebaseRecon, runway } from "./savings.ts";
import { buildView } from "./store.ts";
import { rebaseStore } from "./rebase.ts";

const vlad = { id: "vlad", name: "Влад" };
const masha = { id: "masha", name: "Маша" };
const acc = (id, currency, balance, scope = "family", ownerId, extra = {}) =>
  ({ id, name: id, currency, scope, ...(ownerId && { ownerId }), balance, initial: balance, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "vlad", version: 1, ...extra });
const goal = (id, allocated, currency = "RSD", scope = "family", ownerId) =>
  ({ id, name: id, target: 100000, currency, allocated, scope, ...(ownerId && { ownerId }), ops: [], version: 1 });
const prev = { id: "r1", at: "2026-10-01T12:00:00.000Z", day: "2026-10-01", by: "vlad", rates: { EUR: 110 }, totals: { family: 210000, byUser: {}, all: 210000 } };

test("запас, удаление цели, новый счёт — всегда личный", () => {
  assert.equal(runway(26000, 10000), 2.6);
  assert.equal(runway(26000, null), null);
  assert.equal(runway(26000, 0), null);
  assert.equal(goalDeleteError(goal("g", 300)), "СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ");
  assert.equal(goalDeleteError(goal("g", 0)), null);
  const a = prepareAccount({ name: "Карта", currency: "RSD", scope: "family", balance: 100, primary: true }, "vlad", ["RSD"], "a1", "2026-11-14T10:00:00.000Z", "2026-11-14");
  assert.deepEqual([a.scope, a.ownerId, a.initial, a.initialAt, a.primary], ["personal", "vlad", 100, "2026-11-14", true]);
  assert.equal(prepareAccount({ name: "Карта", currency: "XXX" }, "vlad", ["RSD"], "a1", "", undefined), null);
});

const rawSavings = () => ({
  accounts: { fam: acc("fam", "RSD", 100000) },
  userAccounts: {
    vlad: { vacc: acc("vacc", "EUR", 100, "personal", "vlad") },
    masha: { macc: acc("macc", "RSD", 7777, "personal", "masha", { name: "Секретный вклад Маши", updatedAt: "2026-09-01T10:00:00.000Z" }) },
  },
  goals: { gf: goal("gf", 1000) },
  userGoals: { vlad: { gv: goal("gv", 10, "EUR", "personal", "vlad") }, masha: { gm: { ...goal("gm", 3333, "RSD", "personal", "masha"), name: "Тайная цель Маши" } } },
  recons: [{ ...prev, balances: { fam: 90000, vacc: 100, macc: 5555 }, totals: { family: 90000, byUser: { vlad: 11000, masha: 5555 }, all: 106555 } }],
  ledgerSince: "2026-10-01",
});

test("приватность: в ответе каждого нет личных счетов, копилок и поштучных остатков партнёра", () => {
  const raw = { settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [], version: 1 }, goals: null, userSettings: {}, hashes: {}, savings: rawSavings() };
  for (const [me, partner, hidden] of [
    [vlad, masha, ["macc", "Секретный вклад Маши", "gm", "Тайная цель Маши"]],
    [masha, vlad, ["vacc", "gv"]],
  ]) {
    const view = buildView(raw, me, partner);
    const json = JSON.stringify(view);
    for (const h of hidden) assert.ok(!json.includes(`"${h}"`) && !json.includes(h), `${h} в ответе ${me.id}`);
    assert.ok(!json.includes("balances"), "поштучные остатки снимка");
    // Счета партнёра — только в общей сумме семьи
    assert.equal(view.savings.ledger.familyTotal, 100000 + 100 * 117 + 7777);
    assert.deepEqual(view.savings.accounts.family.map((a) => a.id), ["fam"]);
    assert.equal(view.savings.recons[0].all, 106555);
  }
  const v = buildView(raw, vlad, masha).savings;
  assert.deepEqual([v.recons[0].mine, v.recons[0].partner], [11000, 5555]);
  assert.equal(v.partner, undefined, "сумм и дат обновления партнёра больше нет");
});

test("смена базы: снимки пересчитываются, копилки и счета в своих валютах не трогаются", () => {
  const savings = rawSavings();
  savings.recons[0] = { ...savings.recons[0], rates: { EUR: 117, USD: 100 } };
  const raw = { settings: { base: "RSD", currencies: ["RSD", "EUR", "USD"], rates: { EUR: 117, USD: 100 }, familyCategories: [], version: 1 }, goals: null, userSettings: {}, hashes: {}, savings };
  const next = rebaseStore(raw, { from: "RSD", to: "EUR", rate: 117, limitRounding: 0 }, "2026-10-19");
  const r = next.savings.recons[0];
  assert.equal(r.totals.all, Math.round((106555 / 117) * 100) / 100);
  assert.deepEqual(r.totals.byUser, { vlad: Math.round((11000 / 117) * 100) / 100, masha: Math.round((5555 / 117) * 100) / 100 });
  assert.deepEqual(r.rates, { USD: 100 / 117, RSD: 1 / 117 });
  assert.deepEqual(r.balances, savings.recons[0].balances);
  assert.deepEqual(next.savings.goals, savings.goals);
  assert.deepEqual(next.savings.userGoals, savings.userGoals);
  assert.deepEqual(next.savings.userAccounts, savings.userAccounts);
  assert.ok(Math.abs(rebaseRecon(r, "EUR", "RSD", 1 / 117).totals.all - 106555) < 1); // туда-обратно — с точностью до округления
});
