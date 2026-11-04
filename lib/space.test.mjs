// Бюджет экрана: хранение по пользователю и выборки для ленты, лимитов, сбережений, графика в трёх режимах. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayTitle, feedRows, groupByDay, readSpace, spaceData, spaceGroups, spaceItems, spaceKey, spaceLeft, spaceRecurring, spaceSavings, writeSpace } from "./space.ts";
import { monthExpense, monthIncome } from "./metrics.ts";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test("хранение: по умолчанию семья, отдельно для каждого пользователя, мусор — по умолчанию", () => {
  const s = mem();
  assert.equal(readSpace("vlad", s), "family");
  writeSpace("vlad", "personal", s);
  writeSpace("masha", "all", s);
  assert.equal(readSpace("vlad", s), "personal");
  assert.equal(readSpace("masha", s), "all");
  assert.equal(s.m.get(spaceKey("vlad")), "personal");
  s.setItem(spaceKey("vlad"), "чужое");
  assert.equal(readSpace("vlad", s), "family");
  // localStorage недоступен (приватный режим) — не падает
  const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  assert.equal(readSpace("vlad", broken), "family");
  assert.doesNotThrow(() => writeSpace("vlad", "all", broken));
});

const M = "2026-11";
const ex = (id, scope, authorId, base, date = `${M}-04`, extra = {}) => ({ id, amount: base, currency: "RSD", rate: 1, base, catId: scope === "family" ? "food" : "hobby", note: "", date, ts: Number(id.replace(/\D/g, "")) || 1, scope, authorId, ...extra });
const data = {
  me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" },
  settings: { base: "RSD", currencies: ["RSD"], rates: {}, familyCategories: [{ id: "food", name: "Продукты", limit: 1000 }], version: 1 },
  mySettings: { personalCategories: [{ id: "hobby", name: "Хобби", limit: 300 }], version: 1 },
  familyExpenses: { [M]: [ex("f1", "family", "masha", 100), ex("f2", "family", "vlad", 50, `${M}-03`)] },
  myExpenses: { [M]: [ex("p3", "personal", "vlad", 70)] },
  incomes: { [M]: [{ id: "i1", amount: 5000, currency: "RSD", rate: 1, base: 5000, sourceId: "salary", note: "", date: `${M}-02`, ts: 1, authorId: "masha" }] },
  partnerPersonalTotals: { [M]: 999 }, partnerPersonalDaily: { [M]: { 4: 999 } }, partnerPlannedDaily: {}, partnerLimits: { [M]: 500 },
  partnerRecurring: {}, partnerRecurringDaily: {},
  plans: { [M]: { month: M, incomeOverride: null, familyOverrides: {}, myOverrides: { hobby: 200 }, items: { family: [{ id: "it1", scope: "family" }], mine: [{ id: "it2", scope: "personal" }] }, partner: { plannedTotal: 40, plannedForecast: 40 }, planVersion: 0, myPlanVersion: 0 } },
  recurring: { family: [{ id: "r1", scope: "family" }], mine: [{ id: "r2", scope: "personal" }] },
  savings: {
    accounts: { family: [{ id: "a1", scope: "family" }], mine: [{ id: "a2", scope: "personal" }] },
    goals: { family: [{ id: "g1", scope: "family" }], mine: [{ id: "g2", scope: "personal" }] },
    partner: { total: 1, goalsAllocated: 0, lastUpdatedAt: null }, recons: [],
  },
};
const ids = (rows) => rows.map((r) => r.e.id);

test("лента: семья — семейные обоих и доходы; личное — только мои личные; всё — всё; новые сверху", () => {
  assert.deepEqual(ids(feedRows(data, "family")), ["f1", "f2", "i1"]);
  assert.deepEqual(ids(feedRows(data, "personal")), ["p3"]);
  assert.deepEqual(ids(feedRows(data, "all")), ["p3", "f1", "f2", "i1"]);
});

test("лента по дням: СЕГОДНЯ / ВЧЕРА / 02.11, сумма трат дня без доходов", () => {
  const days = groupByDay(feedRows(data, "all"), `${M}-04`);
  assert.deepEqual(days.map((d) => [d.title, d.spent, d.rows.length]), [["СЕГОДНЯ", 170, 2], ["ВЧЕРА", 50, 1], ["02.11", 0, 1]]);
  assert.equal(dayTitle("2026-10-31", "2026-11-01"), "ВЧЕРА");
});

test("лимиты: остаток выбранного бюджета с поправкой плана; всё — сумма", () => {
  assert.deepEqual(spaceLeft(data, "family", M), { limit: 1000, left: 850 });
  assert.deepEqual(spaceLeft(data, "personal", M), { limit: 200, left: 130 });
  assert.deepEqual(spaceLeft(data, "all", M), { limit: 1200, left: 980 });
});

test("график и метрики: траты и доходы выбранного бюджета; всё — как раньше, с суммами партнёра", () => {
  assert.equal(monthExpense(spaceData(data, "family"), M), 150);
  assert.equal(monthIncome(spaceData(data, "family"), M), 5000);
  assert.equal(monthExpense(spaceData(data, "personal"), M), 70);
  assert.equal(monthIncome(spaceData(data, "personal"), M), 0);
  assert.equal(monthExpense(spaceData(data, "all"), M), 150 + 70 + 999);
  assert.equal(spaceData(data, "all"), data, "всё вместе — те же данные");
  assert.deepEqual(spaceData(data, "family").plans[M].items.mine, []);
  assert.deepEqual(spaceData(data, "personal").plans[M].items.family, []);
  assert.equal(spaceData(data, "family").plans[M].partner.plannedTotal, 0);
});

test("сбережения, регулярные и план: только выбранный бюджет; всё — обе группы", () => {
  const sv = (s) => { const v = spaceSavings(data.savings, s); return [v.accounts.family.map((a) => a.id), v.accounts.personal.map((a) => a.id), v.goals.family.map((g) => g.id), v.goals.personal.map((g) => g.id)]; };
  assert.deepEqual(sv("family"), [["a1"], [], ["g1"], []]);
  assert.deepEqual(sv("personal"), [[], ["a2"], [], ["g2"]]);
  assert.deepEqual(sv("all"), [["a1"], ["a2"], ["g1"], ["g2"]]);
  const rec = [...data.recurring.family, ...data.recurring.mine];
  assert.deepEqual(spaceRecurring(rec, "family").map((p) => p.id), ["r1"]);
  assert.deepEqual(spaceRecurring(rec, "all").map((p) => p.id), ["r1", "r2"]);
  const items = [...data.plans[M].items.family, ...data.plans[M].items.mine];
  assert.deepEqual(spaceItems(items, "personal").map((i) => i.id), ["it2"]);
  assert.deepEqual(spaceGroups("all"), ["family", "personal"]);
  assert.deepEqual(spaceGroups("family"), ["family"]);
});
