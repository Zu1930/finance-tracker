// Тесты плана месяца: лимиты на месяц, шкалы без плановых трат, статусы, сводка, прогноз, приватность, rebase. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemStatus, limitsSum, linkedByItem, monthLimit, normalizeOverrides, planIncome, planLinkError, planMoveError,
  planSpentByCat, planSummary,
} from "./plan.ts";
import { forecast, monthRegular, periodCompare } from "./metrics.ts";
import { buildView } from "./store.ts";
import { rebaseStore } from "./rebase.ts";

const food = { id: "food", name: "Продукты", limit: 40000, history: [{ until: "2026-09", limit: 35000 }] };
const home = { id: "home", name: "Для дома", limit: 10000 };
const item = (id, amount, extra = {}) => ({ id, month: "2026-10", name: id, amount, categoryId: "home", scope: "family", createdBy: "vlad", expenseIds: [], version: 1, ...extra });
let n = 0;
const exp = (catId, base, extra = {}) => ({ id: `e${n++}`, amount: base, currency: "RSD", rate: 1, base, catId, note: "", date: "2026-10-05", ts: n, scope: "family", authorId: "vlad", ...extra });

test("лимит месяца: поправка или обычный (с историей); поправка, равная обычному, удаляется", () => {
  assert.equal(monthLimit(food, "2026-11"), 40000);
  assert.equal(monthLimit(food, "2026-09"), 35000);
  assert.equal(monthLimit(food, "2026-11", { food: 50000 }), 50000);
  assert.equal(limitsSum([food, home], "2026-11", { home: 14000 }), 54000);
  assert.deepEqual(normalizeOverrides({ food: 40000, home: 14000, ghost: 1 }, [food, home], "2026-11"), { home: 14000 });
  assert.deepEqual(normalizeOverrides({ food: 35000 }, [food, home], "2026-09"), {}); // равна лимиту того месяца из истории
  assert.equal(normalizeOverrides({ food: -1 }, [food], "2026-11"), null);
});

test("шкала категории без связанных трат; превышение пункта уходит в категорию; статусы", () => {
  const vac = item("vac", 25000), lamp = item("lamp", 3000), sofa = item("sofa", 50000);
  const list = [
    exp("home", 2000), // обычная
    exp("home", 25000, { planItemId: "vac" }), // ровно по плану
    exp("home", 3500, { planItemId: "lamp" }), // на 500 больше плана
    exp("home", 12000, { planItemId: "sofa" }), // часть
    exp("home", 700, { planItemId: "deleted" }), // пункт удалён — обычная трата
  ];
  const items = [vac, lamp, sofa];
  assert.deepEqual(planSpentByCat(list, items), { home: 2000 + 700 + 500 });
  const linked = linkedByItem(list, items);
  assert.deepEqual(linked, { vac: 25000, lamp: 3500, sofa: 12000 });
  assert.deepEqual([itemStatus(item("x", 100), 0), itemStatus(sofa, linked.sofa), itemStatus(vac, linked.vac), itemStatus(lamp, linked.lamp)], ["planned", "partial", "done", "done"]);
});

test("доход плана и остаток; нехватка; без дохода предупреждения нет", () => {
  assert.equal(planIncome(300000, 388400), 300000);
  assert.equal(planIncome(null, 388400), 388400);
  assert.equal(planIncome(null, null), null);
  const base = { familyLimits: 200000, myLimits: 30000, partnerLimits: 20000, items: [item("a", 25000), item("b", 5000)], partnerPlanned: 10000 };
  const ok = planSummary({ ...base, income: 388400 });
  assert.deepEqual(ok.limits, { family: 200000, mine: 30000, partner: 20000, total: 250000 });
  assert.deepEqual(ok.planned, { total: 40000, count: 2, partner: 10000 });
  assert.equal(ok.rest, 98400);
  assert.equal(ok.short, false);
  const short = planSummary({ ...base, income: 280000 });
  assert.deepEqual([short.rest, short.short], [-10000, true]);
  const none = planSummary({ ...base, income: null });
  assert.deepEqual([none.rest, none.short], [null, false]);
});

const mkData = () => ({
  me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" }, settings: null, mySettings: { personalCategories: [], version: 0 },
  familyExpenses: {}, myExpenses: {}, incomes: {}, partnerPersonalTotals: {}, partnerPersonalDaily: {}, partnerPlannedDaily: {}, plans: {}, partnerLimits: {},
});

test("прогноз: экстраполируются только обычные траты, плановые — max(план, факт); сравнение — по обычным", () => {
  const d = mkData();
  d.familyExpenses["2026-10"] = [
    { ...exp("food", 10000), date: "2026-10-03" },
    { ...exp("home", 20000, { planItemId: "vac" }), date: "2026-10-04" }, // по плану 25 000 — меньше плана
    { ...exp("home", 4000, { planItemId: "lamp" }), date: "2026-10-04" }, // по плану 3 000 — больше
  ];
  d.familyExpenses["2026-09"] = [{ ...exp("food", 10000), date: "2026-09-03" }];
  d.plans["2026-10"] = { month: "2026-10", incomeOverride: null, familyOverrides: {}, myOverrides: {}, items: { family: [item("vac", 25000), item("lamp", 3000), item("tv", 40000)], mine: [] }, partner: { plannedTotal: 6000, plannedForecast: 6000 }, planVersion: 1, myPlanVersion: 0 };
  d.partnerPlannedDaily["2026-10"] = { 6: 1500 };
  d.partnerPersonalTotals["2026-10"] = 1500;
  d.partnerPersonalDaily["2026-10"] = { 6: 1500 };
  const f = forecast(d, "2026-10-10");
  assert.equal(f.forecastRegular, (10000 / 10) * 31);
  assert.equal(f.planned, 25000 + 4000 + 40000 + 6000);
  assert.equal(f.forecastExpense, f.forecastRegular + f.planned);
  assert.equal(monthRegular(d, "2026-10"), 10000);
  assert.equal(periodCompare(d, "2026-10-10").expense, 0); // 10 000 против 10 000: покупки по плану не делают месяц «дороже»
});

test("связь траты с пунктом и перенос", () => {
  const it = item("vac", 25000);
  const e = { catId: "home", scope: "family", date: "2026-10-20" };
  assert.equal(planLinkError(it, e), null);
  assert.ok(planLinkError(null, e)); // чужой личный или не найден
  assert.ok(planLinkError(it, { ...e, catId: "food" }));
  assert.ok(planLinkError(it, { ...e, date: "2026-11-01" }));
  assert.ok(planLinkError(it, { ...e, scope: "personal" }));
  assert.equal(planMoveError(it), null);
  assert.ok(planMoveError({ ...it, expenseIds: ["e1"] }));
});

const raw = () => ({
  settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [food, home], version: 1 },
  goals: null,
  userSettings: {
    vlad: { personalCategories: [{ id: "hobby", name: "Хобби", limit: 8000 }], version: 1 },
    masha: { personalCategories: [{ id: "beauty", name: "Красота", limit: 7000 }, { id: "gym", name: "Спорт", limit: 3000 }], version: 1 },
  },
  hashes: {
    "ft:u:masha:m:2026-11": { m1: { ...exp("beauty", 9000, { planItemId: "pm" }), id: "m1", date: "2026-11-03", scope: "personal", authorId: "masha" } },
  },
  plans: {
    family: { "2026-11": { month: "2026-11", incomeOverride: 350000, limitOverrides: { home: 14000 }, version: 3 } },
    byUser: { vlad: { "2026-11": { month: "2026-11", limitOverrides: { hobby: 12000 }, version: 1 } }, masha: { "2026-11": { month: "2026-11", limitOverrides: { gym: 5555 }, version: 2 } } },
    familyItems: { "2026-11": { f1: { ...item("f1", 25000), month: "2026-11", name: "Пылесос" } } },
    userItems: {
      vlad: { "2026-11": { v1: { ...item("v1", 4000), month: "2026-11", name: "Краски", scope: "personal", ownerId: "vlad", categoryId: "hobby" } } },
      masha: { "2026-11": { pm: { ...item("pm", 8000), month: "2026-11", name: "Тайный подарок", scope: "personal", ownerId: "masha", categoryId: "beauty" } } },
    },
  },
});

test("приватность: личные пункты и поправки партнёра не в ответе, суммы партнёра верны", () => {
  const vlad = { id: "vlad", name: "Влад" }, masha = { id: "masha", name: "Маша" };
  const v = buildView(raw(), vlad, masha, "2026-10");
  const jv = JSON.stringify(v);
  for (const s of ["Тайный подарок", '"pm"', "5555", '"gym"']) assert.ok(!jv.includes(s), `${s} у Влада`);
  const p = v.plans["2026-11"];
  assert.deepEqual(p.items.family.map((i) => i.name), ["Пылесос"]);
  assert.deepEqual(p.items.mine.map((i) => i.name), ["Краски"]);
  assert.deepEqual(p.myOverrides, { hobby: 12000 });
  assert.deepEqual(p.partner, { plannedTotal: 8000, plannedForecast: 9000 });
  assert.equal(v.partnerLimits["2026-11"], 7000 + 5555); // с её поправкой, но одной суммой
  assert.equal(v.partnerLimits["2026-10"], 10000);
  assert.deepEqual(v.partnerPlannedDaily["2026-11"], { 3: 9000 });

  const m = buildView(raw(), masha, vlad, "2026-10");
  const jm = JSON.stringify(m);
  for (const s of ["Краски", '"v1"', '"hobby"']) assert.ok(!jm.includes(s), `${s} у Маши`);
  assert.deepEqual(m.plans["2026-11"].partner, { plannedTotal: 4000, plannedForecast: 4000 });
  assert.equal(m.partnerLimits["2026-11"], 12000);
  assert.deepEqual(m.plans["2026-11"].items.family.map((i) => i.name), ["Пылесос"]);
});

test("rebase пересчитывает пункты, поправки и ожидаемый доход обоих", () => {
  const next = rebaseStore(raw(), { from: "RSD", to: "EUR", rate: 100, limitRounding: 10 }, "2026-10-20").plans;
  assert.equal(next.family["2026-11"].incomeOverride, 3500);
  assert.deepEqual(next.family["2026-11"].limitOverrides, { home: 140 });
  assert.deepEqual(next.byUser.masha["2026-11"].limitOverrides, { gym: 60 }); // 55.55 → шаг 10
  assert.equal(next.familyItems["2026-11"].f1.amount, 250);
  assert.equal(next.userItems.vlad["2026-11"].v1.amount, 40);
  assert.equal(next.userItems.masha["2026-11"].pm.amount, 80);
});
