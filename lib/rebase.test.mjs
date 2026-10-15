// Тесты пересчёта базовой валюты. Запуск: npm run test (node --test, без зависимостей)
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseData, rebaseEntry, rebaseSettings, roundLimit } from "./rebase.ts";

const R = 117.2; // 1 EUR = 117.2 RSD
const toEUR = { from: "RSD", to: "EUR", rate: R, limitRounding: 10 };
const toRSD = { from: "EUR", to: "RSD", rate: 1 / R, limitRounding: 0 };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const exp = (id, amount, currency, rate) => ({ id, amount, currency, rate, base: Math.round(amount * rate * 100) / 100, catId: "c1", note: "", date: "2026-10-10", ts: 1 });

const settings = {
  base: "RSD",
  currencies: ["RSD", "EUR", "USD"],
  rates: { EUR: R, USD: 100.5, GBP: null },
  categories: [{ id: "c1", name: "Продукты", limit: 40000 }, { id: "c2", name: "Кафе", limit: 15000 }],
};

const data = {
  settings,
  goals: [{ id: "g1", name: "Отпуск", target: 150000, ops: [{ id: "o1", amount: 60000, date: "2026-09-01", ts: 1 }] }],
  months: { "m-2026-10": { expenses: [exp("e1", 1200, "RSD", 1), exp("e2", 45, "EUR", R), exp("e3", 30, "USD", 100.5)] } },
  incomes: { "i-2026-10": { items: [{ ...exp("i1", 2100, "EUR", R), sourceId: "salary" }] } },
};

test("запись в NEW получает rate 1 и base = amount", () => {
  const e = rebaseEntry(exp("e", 45, "EUR", 117.5), toEUR);
  assert.equal(e.rate, 1);
  assert.equal(e.base, 45);
});

test("запись в OLD: base = amount / R", () => {
  const e = rebaseEntry(exp("e", 1200, "RSD", 1), toEUR);
  near(e.rate, 1 / R, 1e-12);
  assert.equal(e.base, Math.round((1200 / R) * 100) / 100);
});

test("запись в третьей валюте: amount * rate = base до копейки", () => {
  const e = rebaseEntry(exp("e", 30, "USD", 100.5), toEUR);
  near(e.rate, 100.5 / R, 1e-12);
  near(e.amount * e.rate, e.base);
});

test("rates пересчитаны: ключа NEW нет, OLD = 1/R, null остаётся null", () => {
  const s = rebaseSettings(settings, toEUR, "2026-10-20");
  assert.equal(s.base, "EUR");
  assert.ok(!("EUR" in s.rates));
  near(s.rates.RSD, 1 / R, 1e-12);
  near(s.rates.USD, 100.5 / R, 1e-12);
  assert.equal(s.rates.GBP, null);
  assert.deepEqual(s.currencies, ["EUR", "RSD", "USD"]);
  assert.deepEqual(s.baseHistory, [{ from: "RSD", to: "EUR", rate: R, at: "2026-10-20" }]);
});

test("лимиты округляются по выбранному шагу", () => {
  // 40000 / 117.2 = 341.2969…
  assert.equal(roundLimit(40000 / R, 10), 340);
  assert.equal(roundLimit(40000 / R, 100), 300);
  assert.equal(roundLimit(40000 / R, 1), 341);
  assert.equal(roundLimit(40000 / R, 0), 341.3);
  const s = rebaseSettings(settings, toEUR, "2026-10-20");
  assert.deepEqual(s.categories.map((c) => c.limit), [340, 130]);
});

test("туда и обратно с тем же R возвращает исходные суммы", () => {
  const back = rebaseData(rebaseData(data, toEUR, "2026-10-20"), toRSD, "2026-10-21");
  assert.equal(back.settings.base, "RSD");
  const [e1, e2, e3] = back.months["m-2026-10"].expenses;
  assert.equal(e1.base, 1200); // запись в RSD снова точная
  near(e2.base, data.months["m-2026-10"].expenses[1].base);
  near(e3.base, data.months["m-2026-10"].expenses[2].base);
  near(back.incomes["i-2026-10"].items[0].base, data.incomes["i-2026-10"].items[0].base);
  near(back.settings.rates.EUR, R, 1e-9);
  near(back.settings.rates.USD, 100.5, 1e-9);
  // Копилки округляются до копеек на каждом шаге — погрешность в пределах R * 0.005
  near(back.goals[0].target, 150000, R * 0.005);
  near(back.goals[0].ops[0].amount, 60000, R * 0.005);
  // Лимиты — до шага округления: 40000 → 340 EUR → 39848 RSD
  near(back.settings.categories[0].limit, 40000, (10 / 2) * R);
  assert.equal(back.settings.baseHistory.length, 2);
});
