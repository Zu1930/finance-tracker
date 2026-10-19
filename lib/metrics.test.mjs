// Тесты сравнительных показателей. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  average, completedMonths, forecast, goalsTotal, monthlySeries, periodCompare, runwayMonths, savingsRate, savingsRates,
} from "./metrics.ts";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
let n = 0;
const exp = (date, base) => ({ id: `e${n++}`, amount: base, currency: "RSD", rate: 1, base, catId: "c", note: "", date, ts: n });
const inc = (date, base) => ({ ...exp(date, base), sourceId: "salary" });

/** Данные из списка записей: [тип, дата, сумма]. e — семейная трата, p — моя личная, q — личная партнёра, i — доход */
function make(records, goals = []) {
  const data = {
    me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" },
    settings: null, mySettings: { personalCategories: [], version: 0 }, goals, goalsVersion: 0,
    familyExpenses: {}, myExpenses: {}, incomes: {}, partnerPersonalTotals: {}, partnerPersonalDaily: {},
  };
  for (const [kind, date, base] of records) {
    const k = date.slice(0, 7);
    if (kind === "e") (data.familyExpenses[k] ??= []).push(exp(date, base));
    else if (kind === "p") (data.myExpenses[k] ??= []).push(exp(date, base));
    else if (kind === "q") {
      data.partnerPersonalTotals[k] = (data.partnerPersonalTotals[k] ?? 0) + base;
      const day = String(Number(date.slice(8)));
      (data.partnerPersonalDaily[k] ??= {})[day] = ((data.partnerPersonalDaily[k] ?? {})[day] ?? 0) + base;
    } else (data.incomes[k] ??= []).push(inc(date, base));
  }
  return data;
}
const empty = make([]);

test("норма сбережений: обычный случай, нулевой доход, расход больше дохода", () => {
  near(savingsRate(1000, 370), 0.63);
  assert.equal(savingsRate(0, 500), null);
  near(savingsRate(1000, 1500), -0.5);
});

test("completedMonths: n завершённых месяцев без текущего, через границу года", () => {
  assert.deepEqual(completedMonths("2026-02-10", 3), ["2025-11", "2025-12", "2026-01"]);
});

test("среднее за 3 месяца пропускает пустые месяцы до начала учёта", () => {
  // Учёт начат в сентябре: июль и август пустые и не должны делить сумму на 3
  const data = make([["i", "2026-09-05", 200000], ["e", "2026-09-10", 120000]]);
  const avg = average(data, "2026-10-14");
  assert.deepEqual(avg, { income: 200000, expense: 120000, months: 1 });
  assert.equal(average(empty, "2026-10-14"), null);
  // Среднее норм — по суммам, а не среднее процентов
  const two = make([["i", "2026-08-01", 100], ["e", "2026-08-02", 0], ["i", "2026-09-01", 300], ["e", "2026-09-02", 300]]);
  near(savingsRates(two, "2026-10-14").average, (400 - 300) / 400);
});

test("честное сравнение: 14 октября против 1–14 сентября", () => {
  const data = make([
    ["e", "2026-09-10", 1000], ["e", "2026-09-20", 9999], // 20 сентября не входит в период
    ["e", "2026-10-05", 1180],
    ["i", "2026-09-01", 100000], ["i", "2026-10-01", 104000],
  ]);
  const c = periodCompare(data, "2026-10-14");
  assert.equal(c.prevKey, "2026-09");
  assert.equal(c.prevDays, 14);
  near(c.expense, 0.18);
  near(c.income, 0.04);
});

test("честное сравнение: 31 марта против всего февраля (28 и 29 дней)", () => {
  assert.equal(periodCompare(empty, "2026-03-31").prevDays, 28);
  assert.equal(periodCompare(empty, "2028-03-31").prevDays, 29);
  const data = make([["e", "2026-02-28", 100], ["e", "2026-03-31", 150]]);
  near(periodCompare(data, "2026-03-31").expense, 0.5);
  // Нулевая база — null, а не Infinity
  assert.equal(periodCompare(empty, "2026-03-31").income, null);
});

test("прогноз: null в первые 3 дня", () => {
  const data = make([["e", "2026-10-02", 500]]);
  assert.equal(forecast(data, "2026-10-03"), null);
  assert.notEqual(forecast(data, "2026-10-04"), null);
});

test("прогноз: экстраполяция расходов и средний доход при incomeIsExpected", () => {
  const data = make([
    ["i", "2026-07-05", 300000], ["i", "2026-08-05", 300000], ["i", "2026-09-05", 300000],
    ["e", "2026-09-10", 190000],
    ["i", "2026-10-01", 50000], ["e", "2026-10-10", 140000],
  ]);
  const f = forecast(data, "2026-10-14");
  near(f.forecastExpense, (140000 / 14) * 31);
  assert.equal(f.incomeIsExpected, true);
  assert.equal(f.expectedIncome, 300000);
  near(f.forecastBalance, 300000 - (140000 / 14) * 31);
  assert.equal(f.lastDay, 31);
  // Получено больше среднего — берётся фактический доход
  const rich = make([["i", "2026-09-05", 100], ["i", "2026-10-01", 500], ["e", "2026-10-10", 100]]);
  const g = forecast(rich, "2026-10-14");
  assert.equal(g.incomeIsExpected, false);
  assert.equal(g.expectedIncome, 500);
  // Без истории — без среднего, без флага, без NaN
  const fresh = forecast(make([["e", "2026-10-10", 100]]), "2026-10-14");
  assert.equal(fresh.incomeIsExpected, false);
  assert.equal(fresh.vsAverage, null);
});

test("запас прочности при нулевом и обычном среднем", () => {
  const goals = [{ id: "g", name: "Отпуск", target: 1, ops: [{ id: "o", amount: 340000, date: "2026-09-01", ts: 1 }] }];
  assert.equal(runwayMonths(make([], goals), "2026-10-14"), null);
  // Есть поступления, но нет трат: средний расход 0 — тоже null, без деления на ноль
  assert.equal(runwayMonths(make([["i", "2026-09-01", 1000]], goals), "2026-10-14"), null);
  assert.equal(runwayMonths(make([["e", "2026-09-10", 100000]], goals), "2026-10-14"), 3.4);
});

test("накопительный остаток для 3 месяцев", () => {
  const data = make([
    ["i", "2026-08-01", 300], ["e", "2026-08-02", 100],
    ["i", "2026-09-01", 300], ["e", "2026-09-02", 400],
    ["e", "2026-10-02", 50],
  ]);
  const s = monthlySeries(data, ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(s.map((p) => p.balance), [200, -100, -50]);
  assert.deepEqual(s.map((p) => p.cumulative), [200, 100, 50]);
  assert.deepEqual(s.map((p) => [p.income, p.expense]), [[300, 100], [300, 400], [0, 50]]);
});

test("пустой аккаунт: нигде нет NaN и Infinity", () => {
  const today = "2026-10-14";
  const values = [
    ...Object.values(savingsRates(empty, today)),
    ...Object.values(periodCompare(empty, today)).filter((v) => typeof v !== "string"),
    ...Object.values(forecast(empty, today)).filter((v) => typeof v === "number"),
    runwayMonths(empty, today),
    ...monthlySeries(empty, ["2026-10"]).flatMap((p) => [p.expense, p.income, p.cumulative]),
  ];
  for (const v of values) assert.ok(v === null || Number.isFinite(v), `значение ${v}`);
});

test("семья: мои личные и личные суммы партнёра входят в расходы, в сравнении периода — по дням", () => {
  const data = make([
    ["e", "2026-09-05", 100], ["p", "2026-09-06", 50], ["q", "2026-09-07", 30], ["q", "2026-09-25", 999],
    ["e", "2026-10-05", 120], ["p", "2026-10-06", 60], ["q", "2026-10-07", 36],
  ]);
  // 1–14 сентября: 100 + 50 + 30 (25-е число партнёра не входит) = 180; октябрь: 216 → +20%
  near(periodCompare(data, "2026-10-14").expense, 0.2);
  // Месяц партнёра без записей у меня всё равно учитывается в средних
  const onlyPartner = make([["q", "2026-09-10", 500]]);
  assert.deepEqual(average(onlyPartner, "2026-10-14"), { income: 0, expense: 500, months: 1 });
});

test("копилки в разных валютах: итог и запас прочности — в базовой по текущему курсу", () => {
  const goals = [
    { id: "a", name: "RSD", target: 1, ops: [{ id: "1", amount: 100000, date: "2026-09-01", ts: 1 }] },
    { id: "b", name: "EUR", target: 1, ops: [{ id: "2", amount: 1000, date: "2026-09-01", ts: 1 }], currency: "EUR" },
    { id: "c", name: "GBP", target: 1, ops: [{ id: "3", amount: 50, date: "2026-09-01", ts: 1 }], currency: "GBP" },
  ];
  const data = { ...make([["e", "2026-09-10", 100000]], goals), settings: { base: "RSD", currencies: ["RSD", "EUR", "GBP"], rates: { EUR: 117.2, GBP: null }, familyCategories: [], version: 1 } };
  assert.deepEqual(goalsTotal(data), { total: 100000 + 117200, missing: ["GBP"] });
  assert.equal(runwayMonths(data, "2026-10-14"), 2.2); // 217 200 / 100 000
});
