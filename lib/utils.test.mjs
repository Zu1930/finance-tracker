// Форматирование сумм: без «-0». Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, minus, signed } from "./utils.ts";
import { fmtChange, fmtPct } from "./metrics.ts";

test("ноль после округления — «0» без знака", () => {
  for (const z of [0, -0, -0.001, 0.004, -0.0049]) assert.equal(fmt(z), "0");
  assert.equal(signed(-0.004), "0");
  assert.equal(signed(-0), "0");
  assert.equal(minus(0), "0");
  assert.equal(minus(-0.001), "0");
  assert.equal(fmtPct(-0.001), "0%");
  assert.equal(fmtChange(-0.004), "0%");
  // Обычные значения — со знаком
  assert.equal(signed(-1250), "−1 250");
  assert.equal(signed(300), "+300");
  assert.equal(minus(1250.5), "−1 250,5");
  assert.equal(fmtPct(-0.12), "−12%");
});

test("fmtRate: 4 значащие цифры, но не меньше 2 знаков после запятой; ru-RU", async () => {
  const { fmtRate } = await import("./utils.ts");
  const sp = (s) => s.replace(/ | /g, " ");
  assert.equal(fmtRate(117.467), "117,47");
  assert.equal(fmtRate(0.00851424), "0,008514");
  assert.equal(fmtRate(0.0085), "0,0085");
  assert.equal(fmtRate(1.28391), "1,284");
  assert.equal(fmtRate(1.2), "1,20");
  assert.equal(fmtRate(117), "117,00");
  assert.equal(sp(fmtRate(11747.3)), "11 747,30");
  assert.equal(fmtRate(0.5), "0,50");
});

test("parseAmount и parseRate: запятая и точка; курс не округляется до копеек", async () => {
  const { parseAmount, parseRate, numIn } = await import("./utils.ts");
  assert.equal(parseAmount("117,467"), 117.47);
  assert.equal(parseAmount("117.467"), 117.47);
  assert.equal(parseAmount("1 250,5"), 1250.5);
  assert.equal(parseAmount("450+120,5"), 570.5);
  assert.equal(parseRate("117,467"), 117.467);
  assert.equal(parseRate("117.467"), 117.467);
  assert.equal(parseRate("0,0085"), 0.0085, "1 RSD = 0,0085 EUR, а не 0,01");
  assert.equal(parseRate(",5"), 0.5);
  assert.equal(parseRate(""), null);
  assert.ok(Number.isNaN(parseRate("1,2,3")));
  assert.ok(Number.isNaN(parseRate("abc")));
  assert.equal(numIn(117.467), "117,467");
  assert.equal(numIn(0.0085), "0,0085");
  assert.equal(numIn(null), "");
  assert.equal(parseRate(numIn(0.008514243)), 0.008514243, "поле → число без потерь");
});

test("CSV: числа с запятой, ячейки с ; и кавычками экранируются", async () => {
  const { entriesCsv } = await import("./export.ts");
  const csv = entriesCsv({
    me: { id: "a", name: "Анна" }, partner: null, names: { a: "Анна" },
    settings: { base: "EUR", currencies: ["EUR"], rates: {}, familyCategories: [], version: 1 },
    mySettings: { personalCategories: [{ id: "c", name: "Еда", limit: 1 }], version: 1 },
    familyExpenses: {}, incomes: {},
    myExpenses: { "2026-10": [{ id: "x", amount: 300, currency: "RSD", rate: 0.0085, base: 2.55, catId: "c", note: 'сыр; "бри"', date: "2026-10-23", ts: 1, scope: "personal", authorId: "a" }] },
  });
  assert.equal(csv.split("\n")[1], '2026-10-23;мой расход;Еда;300;RSD;2,55;Анна;"сыр; ""бри"""');
});
