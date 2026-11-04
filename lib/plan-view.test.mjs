// Мобильные «Лимиты» и мастер плана: «на день можно», пример в столбик против lib/plan.ts, черновик мастера. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bulkBody, buyCategory, buyChips, daysLeft, draftEquation, equationTotal, finalLimit, hasPlan, initDraft, isDirty, living, livingStep, perDay, planEquation, wizardInput,
} from "./plan-view.ts";
import { limitsSum, planIncome, planSummary, prepareBulk } from "./plan.ts";
import { average, monthRecurring } from "./metrics.ts";

test("на день можно: остаток на оставшиеся дни включая сегодня; последний день; перерасход", () => {
  assert.equal(daysLeft("2026-11-05"), 26);
  assert.equal(daysLeft("2026-11-30"), 1);
  assert.equal(daysLeft("2028-02-29"), 1);
  assert.deepEqual(perDay(26000, "2026-11-05"), { days: 26, perDay: 1000, over: 0 });
  // Последний день: весь остаток на сегодня
  assert.deepEqual(perDay(1234, "2026-11-30"), { days: 1, perDay: 1234, over: 0 });
  // Перерасход: на день 0, сверх лимитов — сколько
  assert.deepEqual(perDay(-500, "2026-11-20"), { days: 11, perDay: 0, over: 500 });
  assert.deepEqual(perDay(0, "2026-11-20"), { days: 11, perDay: 0, over: 0 });
});

// ---------- Данные: ноябрь — текущий, декабрь — планируемый ----------
const NOV = "2026-11", DEC = "2026-12", OCT = "2026-10", TODAY = "2026-11-05";
let n = 0;
const ex = (scope, catId, base, date, extra = {}) => ({ id: `e${++n}`, amount: base, currency: "RSD", rate: 1, base, catId, note: "", date, ts: n, scope, authorId: "vlad", ...extra });
const pay = (id, scope, categoryId, amount, extra = {}) => ({
  id, name: id.toUpperCase(), currency: "RSD", approx: false, frequency: "monthly", day: 1, categoryId, scope, startMonth: "2026-01", paused: false, skips: [], amounts: [{ fromMonth: "2026-01", amount }], createdBy: "vlad", version: 1, ...extra,
});
const item = (id, scope, month, categoryId, amount, extra = {}) => ({ id, month, name: id, amount, categoryId, scope, createdBy: "vlad", expenseIds: [], version: 1, ...extra });
const plan = (month, extra = {}) => ({ month, incomeOverride: null, familyOverrides: {}, myOverrides: {}, items: { family: [], mine: [] }, partner: { plannedTotal: 0, plannedForecast: 0 }, planVersion: 0, myPlanVersion: 0, ...extra });
const incomes = (m, base) => [{ id: `i${m}`, amount: base, currency: "RSD", rate: 1, base, sourceId: "salary", note: "", date: `${m}-10`, ts: 1, authorId: "vlad" }];

const data = {
  me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" },
  settings: {
    base: "RSD", currencies: ["RSD"], rates: {}, version: 1,
    familyCategories: [{ id: "home", name: "Жильё", limit: 60000 }, { id: "food", name: "Продукты", limit: 50000 }, { id: "other", name: "Прочее", limit: 6000 }],
  },
  mySettings: { personalCategories: [{ id: "hobby", name: "Хобби", limit: 10000 }], version: 1 },
  familyExpenses: {
    [OCT]: [ex("family", "food", 30000, `${OCT}-03`), ex("family", "home", 52740, `${OCT}-01`, { recurringId: "rent", recurringMonth: OCT })],
    [NOV]: [ex("family", "food", 31200, `${NOV}-03`), ex("family", "home", 52740, `${NOV}-01`, { recurringId: "rent", recurringMonth: NOV })],
  },
  myExpenses: { [NOV]: [ex("personal", "hobby", 2000, `${NOV}-02`)] },
  incomes: { "2026-08": incomes("2026-08", 300000), "2026-09": incomes("2026-09", 330000), [OCT]: incomes(OCT, 360000) },
  partnerPersonalTotals: {}, partnerPersonalDaily: {}, partnerPlannedDaily: {}, partnerLimits: { [NOV]: 12000, [DEC]: 12000 },
  partnerRecurring: { [NOV]: 1500, [DEC]: 1500 }, partnerRecurringDaily: {},
  plans: {
    [NOV]: plan(NOV, { planVersion: 2, incomeOverride: 350000, items: { family: [item("vac", "family", NOV, "other", 25000)], mine: [] } }),
    [DEC]: plan(DEC, { familyOverrides: { food: 55000 }, items: { family: [item("tv", "family", DEC, "other", 40000)], mine: [item("book", "personal", DEC, "hobby", 3000)] }, partner: { plannedTotal: 2000, plannedForecast: 2000 } }),
  },
  recurring: {
    family: [pay("rent", "family", "home", 52740), pay("net", "family", "home", 2990, { day: 20 }), pay("gym", "family", "other", 4000, { skips: [DEC] })],
    mine: [pay("phone", "personal", "hobby", 1990)],
  },
  savings: { accounts: { family: [], mine: [] }, goals: { family: [], mine: [] }, partner: { total: 0, goalsAllocated: 0, lastUpdatedAt: null }, recons: [] },
};

test("осталось на жизнь: лимиты без обязательных, неоплаченные обязательные вычтены из остатка", () => {
  // Семья, ноябрь: лимиты 116 000, обязательные 52 740 (оплачено) + 2 990 + 4 000 = 59 730; потрачено 31 200 + 52 740 + покупка vac не в тратах
  const l = living(data, "family", NOV, TODAY);
  assert.equal(l.limit, 116000 - 59730);
  assert.equal(l.left, 116000 - (31200 + 52740) - (2990 + 4000));
});

test("пример в столбик = planSummary: те же доход, лимиты, покупки и остаток", () => {
  for (const [view, solo] of [["family", false], ["personal", false], ["all", false], ["family", true]]) {
    for (const month of [NOV, DEC]) {
      const p = data.plans[month];
      const personal = view === "personal";
      const s = planSummary({
        income: personal ? null : planIncome(p.incomeOverride, average(data, TODAY)?.income ?? null),
        familyLimits: solo || personal ? 0 : limitsSum(data.settings.familyCategories, month, p.familyOverrides),
        myLimits: limitsSum(data.mySettings.personalCategories, month, p.myOverrides),
        partnerLimits: solo || personal ? 0 : data.partnerLimits[month],
        items: personal ? p.items.mine : [...p.items.family, ...p.items.mine],
        partnerPlanned: personal ? 0 : p.partner.plannedTotal,
        recurring: monthRecurring(data, month, TODAY),
      });
      const e = planEquation(data, view, solo, month, TODAY);
      const label = `${view}${solo ? " solo" : ""} ${month}`;
      assert.equal(e.income, s.income, label);
      assert.equal(e.purchases, s.planned.total, label);
      assert.equal(e.rest, s.rest, label);
      // Придёт − обязательные − на жизнь − покупки = отложится
      if (e.income !== null) assert.equal(Math.round((e.income - e.required - e.living - e.purchases) * 100) / 100, e.rest, label);
      else assert.equal(equationTotal(e), s.limits.total + s.planned.total, label);
    }
  }
  // Семья, декабрь: обязательные — семейные без пропущенного спортзала
  const dec = planEquation(data, "family", false, DEC, TODAY);
  assert.equal(dec.required, 52740 + 2990);
  assert.equal(dec.income, 330000);
});

test("план создан: семья — по семейному документу, личное — по своему", () => {
  assert.equal(hasPlan(data, "family", false, NOV), true);
  assert.equal(hasPlan(data, "family", false, DEC), true, "есть покупки");
  assert.equal(hasPlan(data, "personal", false, NOV), false);
  assert.equal(hasPlan(data, "family", false, "2027-01"), false);
});

test("мастер: черновик без изменений даёт тот же итог, что и план, и ничего не меняет", () => {
  const w = wizardInput(data, "family", false, DEC, TODAY);
  const d = initDraft(w);
  assert.equal(isDirty(w, d), false);
  assert.equal(d.income, "330000");
  assert.deepEqual(d.on, { rent: true, net: true, gym: false });
  assert.deepEqual(draftEquation(w, d), planEquation(data, "family", false, DEC, TODAY));
  const b = bulkBody(w, d);
  assert.deepEqual(b.skips, []);
  assert.deepEqual(b.add, []);
  assert.deepEqual(b.remove, []);
  assert.equal(b.family.incomeOverride, null, "доход по среднему остаётся по среднему");
  assert.deepEqual(b.family.limitOverrides, { food: 55000 });
  assert.equal(b.mine, undefined);
});

test("мастер: снятая отметка — пропуск месяца и меньше лимит категории; повторная — без изменений", () => {
  const w = wizardInput(data, "family", false, DEC, TODAY);
  const d0 = initDraft(w);
  const off = { ...d0, on: { ...d0.on, rent: false } };
  assert.equal(isDirty(w, off), true);
  assert.deepEqual(bulkBody(w, off).skips, [{ id: "rent", skip: true }]);
  // Деньги аренды не уходят «на жизнь»: лимит Жилья уменьшается, отложится больше на 52 740
  assert.equal(finalLimit(w, off, w.cats[0]), 60000 - 52740);
  assert.equal(bulkBody(w, off).family.limitOverrides.home, 60000 - 52740);
  assert.equal(draftEquation(w, off).rest - draftEquation(w, d0).rest, 52740);
  const back = { ...off, on: { ...off.on, rent: true } };
  assert.equal(isDirty(w, back), false);
  assert.deepEqual(bulkBody(w, back).skips, []);
  // Пропущенный ранее — отметка возвращает месяц
  assert.deepEqual(bulkBody(w, { ...d0, on: { ...d0.on, gym: true } }).skips, [{ id: "gym", skip: false }]);
});

test("мастер: шаг «на жизнь» меняет только поправку месяца", () => {
  const w = wizardInput(data, "family", false, DEC, TODAY);
  const d = { ...initDraft(w), living: { food: 45000 } };
  const b = bulkBody(w, d);
  assert.deepEqual(b.family.limitOverrides, { food: 45000 });
  assert.equal(Object.hasOwn(b, "settings"), false);
  assert.equal(draftEquation(w, d).rest - draftEquation(w, initDraft(w)).rest, 10000);
  // Вернули к обычному — поправки нет
  const same = bulkBody(w, { ...initDraft(w), living: { food: 50000 } });
  assert.deepEqual(same.family.limitOverrides, {});
  assert.equal(livingStep("RSD"), 1000);
  assert.equal(livingStep("EUR"), 10);
});

test("мастер: покупки — добавить, убрать, перенести из прошлого месяца; подсказки без повторов", () => {
  const prev = { ...data, plans: { ...data.plans, [NOV]: plan(NOV, { items: { family: [item("tires", "family", NOV, "other", 48000)], mine: [] } }) } };
  const w = wizardInput(prev, "family", false, DEC, TODAY);
  const d0 = initDraft(w);
  assert.deepEqual(buyChips(w, d0, "Подарки на НГ").map((c) => c.kind === "carry" ? c.item.id : c.name), ["tires", "Подарки на НГ"]);
  const d = { ...d0, buys: [{ key: "n1", name: "Подарки на НГ", amount: 20000, categoryId: "other" }, { key: "tires", name: "tires", amount: 48000, categoryId: "other", id: "tires", from: NOV }] };
  assert.deepEqual(buyChips(w, d, "Подарки на НГ"), []);
  const b = bulkBody(w, d);
  assert.deepEqual(b.add, [{ name: "Подарки на НГ", amount: 20000, categoryId: "other" }]);
  assert.deepEqual(b.remove, ["tv"]);
  assert.deepEqual(b.move, [{ id: "tires", from: NOV }]);
});

test("мастер: категория покупки по названию, неуверенно — «Прочее»", () => {
  const cats = data.settings.familyCategories;
  assert.equal(buyCategory("продукты на праздник", cats, "family", {}, TODAY), "food");
  assert.equal(buyCategory("пылесос", cats, "family", {}, TODAY), "other");
  assert.equal(buyCategory("пылесос", cats, "family", { пылесос: { home: 5 } }, TODAY), "home");
});

test("мастер в личном бюджете: свои лимиты и платежи, без дохода и без строки партнёра", () => {
  const w = wizardInput(data, "personal", false, DEC, TODAY);
  assert.equal(w.withIncome, false);
  assert.deepEqual(w.cats.map((c) => c.id), ["hobby"]);
  assert.deepEqual(w.payments.map((p) => p.id), ["phone"]);
  assert.deepEqual(w.others, { limits: 0, purchases: 0 });
  const d = { ...initDraft(w), living: { hobby: 9000 } };
  const b = bulkBody(w, d);
  assert.equal(b.family, undefined);
  assert.deepEqual(b.mine, { version: 0, limitOverrides: { hobby: 9000 + 1990 } });
  assert.equal(draftEquation(w, d).rest, null);
});

test("bulk: проверка тела — лимиты нормализуются, покупки с автором из сессии, мусор — 400", () => {
  const cats = { family: data.settings.familyCategories, mine: data.mySettings.personalCategories };
  let i = 0;
  const id = () => `n${++i}`;
  const ok = prepareBulk({ scope: "family", family: { version: 3, incomeOverride: 1000.555, limitOverrides: { food: 50000, home: 1 } }, skips: [{ id: "rent", skip: true }], add: [{ name: " ТВ ", amount: 10, categoryId: "other" }], remove: ["tv"], move: [{ id: "x", from: NOV }] }, "masha", cats, DEC, id);
  assert.deepEqual(ok.family, { expected: 3, data: { month: DEC, incomeOverride: 1000.56, limitOverrides: { home: 1 } } });
  assert.equal(ok.add[0].createdBy, "masha");
  assert.equal(ok.add[0].month, DEC);
  assert.equal(ok.add[0].name, "ТВ");
  for (const bad of [
    { family: { version: -1, incomeOverride: null } },
    { mine: { version: 0, limitOverrides: { hobby: -1 } } },
    { skips: [{ id: "rent" }] },
    { add: [{ name: "x", amount: 0, categoryId: "other" }] },
    { move: [{ id: "x", from: DEC }] },
    { remove: Array(51).fill("x") },
  ]) assert.equal(prepareBulk({ scope: "family", ...bad }, "vlad", cats, DEC, id), null, JSON.stringify(bad).slice(0, 60));
});
