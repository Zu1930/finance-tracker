// Голосовой ввод: разбор фраз и словарь. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhrase } from "./parse.ts";
import { buildDictionary, visibleExpenses } from "./dictionary.ts";
import { buildView } from "../store.ts";

const family = [
  { id: "food", name: "Продукты", limit: 1 },
  { id: "cafe", name: "Кафе и рестораны", limit: 1 },
  { id: "transport", name: "Транспорт", limit: 1 },
  { id: "home", name: "Дом и связь", limit: 1 },
  { id: "health", name: "Здоровье", limit: 1 },
  { id: "fun", name: "Развлечения", limit: 1 },
  { id: "other", name: "Прочее", limit: 1 },
];
const personal = [{ id: "hobby", name: "Хобби", limit: 1 }];
// 2026-10-20 — вторник
const ctx = (extra = {}) => ({
  today: "2026-10-20", base: "RSD", currencies: ["RSD", "EUR"], familyCategories: family, personalCategories: personal,
  dictionary: {}, lastScope: "family", ...extra,
});
const one = (text, extra) => {
  const list = parsePhrase(text, ctx(extra));
  assert.equal(list.length, 1, `${text}: ${JSON.stringify(list)}`);
  return list[0];
};

test("кофе 350 → 350 RSD, КАФЕ, high, заметка «кофе» остаётся", () => {
  const e = one("кофе 350");
  assert.deepEqual([e.amount, e.currency, e.categoryId, e.categoryConfidence, e.note, e.date, e.scope, e.errors], [350, "RSD", "cafe", "high", "кофе", "2026-10-20", "family", []]);
});

test("числа словами, суффиксы, склейка диктовки, разделители", () => {
  const e = one("тысяча двести продукты");
  assert.deepEqual([e.amount, e.categoryId, e.note], [1200, "food", ""]);
  assert.equal(one("полторы тысячи такси").amount, 1500);
  assert.equal(one("полторы тысячи такси").categoryId, "transport");
  assert.equal(one("такси 100 50").amount, 150);
  assert.equal(one("триста пятьдесят кофе").amount, 350);
  assert.equal(one("две тысячи триста продукты").amount, 2300);
  assert.equal(one("девятьсот девяносто девять тысяч прочее").amount, 999000);
  assert.equal(one("1 200 продукты").amount, 1200);
  assert.equal(one("1 200 продукты").amount, 1200);
  assert.equal(one("1.200 продукты").amount, 1200);
  assert.equal(one("кофе 12,50").amount, 12.5);
  assert.equal(one("1,5к продукты").amount, 1500);
  assert.equal(one("2 тыс продукты").amount, 2000);
  assert.equal(one("2 тысячи продукты").amount, 2000);
  // Второе не меньше разряда первого — два числа, берётся последнее, первое — в заметку
  const e2 = one("кафе 35 80");
  assert.deepEqual([e2.amount, e2.note], [80, "35"]);
  // Число с валютой важнее последнего
  const e3 = one("5 евро за 2 кофе");
  assert.deepEqual([e3.amount, e3.currency], [5, "EUR"]);
});

test("2к лидл → 2000, ПРОДУКТЫ", () => {
  const e = one("2к лидл");
  assert.deepEqual([e.amount, e.categoryId, e.note], [2000, "food", "лидл"]);
});

test("валюта и дата: 45 евро интернет вчера", () => {
  const e = one("45 евро интернет вчера");
  assert.deepEqual([e.amount, e.currency, e.date, e.note], [45, "EUR", "2026-10-19", "интернет"]);
  assert.equal(one("€45 кофе").currency, "EUR");
  assert.deepEqual(one("20 долларов").errors, ["UNKNOWN_CURRENCY"]);
  assert.equal(one("20 долларов").currency, "USD");
  assert.equal(one("позавчера кофе 300").date, "2026-10-18");
});

test("дни недели и числа месяца — ближайшие не в будущем", () => {
  assert.equal(one("пятница кино 1200").date, "2026-10-16");
  assert.equal(one("в пятницу кино 1200").note, "кино");
  assert.equal(one("вторник кофе 300").date, "2026-10-20");
  assert.equal(one("12-го аптека 900").date, "2026-10-12");
  assert.equal(one("12-го аптека 900", { today: "2026-10-05" }).date, "2026-09-12");
  assert.equal(one("31 числа кофе 300", { today: "2026-10-05" }).date, "2026-08-31");
  assert.equal(one("12.10 кофе 300").date, "2026-10-12");
  assert.equal(one("12 ноября кофе 300").date, "2025-11-12");
  assert.equal(one("12 октября кофе 300").amount, 300);
  assert.equal(one("12-го аптека 900").categoryId, "health");
});

test("scope: себе / в дом, иначе по набору категорий, иначе lastScope", () => {
  assert.equal(one("себе кофе 350").scope, "personal");
  assert.equal(one("в дом лампа 900", { lastScope: "personal" }).scope, "family");
  assert.equal(one("хобби 500").scope, "personal");
  assert.equal(one("хобби 500").categoryId, "hobby");
  assert.equal(one("непонятно 500", { lastScope: "personal" }).scope, "personal");
});

test("несколько трат одной фразой; без суммы в куске — одна", () => {
  const two = parsePhrase("кофе 350 и такси 800", ctx());
  assert.deepEqual(two.map((e) => [e.amount, e.categoryId, e.raw]), [[350, "cafe", "кофе 350"], [800, "transport", "такси 800"]]);
  assert.equal(parsePhrase("кофе 350, такси 800; лидл 2000", ctx()).length, 3);
  assert.equal(parsePhrase("Кофе 350 и такси 800.", ctx()).length, 2);
  const single = one("продукты и бытовая химия 2400");
  assert.deepEqual([single.amount, single.categoryId, single.note], [2400, "food", "бытовая химия"]);
  assert.equal(parsePhrase("кофе триста пятьдесят и такси восемьсот", ctx()).map((e) => e.amount).join(), "350,800");
});

test("ошибки и категория none", () => {
  assert.deepEqual(one("кофе").errors, ["NO_AMOUNT"]);
  assert.equal(one("кофе").amount, null);
  const e = one("хрень 500");
  assert.deepEqual([e.categoryId, e.categoryConfidence, e.candidates, e.note], [null, "none", [], "хрень"]);
  assert.equal(one("constructor 500").categoryConfidence, "none");
});

test("словарь: слово из заметок прошлых трат даёт категорию; low при равенстве", () => {
  const exp = (note, catId, date = "2026-10-01") => ({ id: note + catId + date, amount: 1, currency: "RSD", rate: 1, base: 1, catId, note, date, ts: 1, scope: "family", authorId: "vlad" });
  const dictionary = buildDictionary([exp("стрижка у Ани", "other"), exp("стрижка", "other"), exp("стрижка", "other", "2025-01-01")], "2026-10-20");
  assert.deepEqual(dictionary["стрижка"], { other: 2 });
  const e = one("стрижка 1500", { dictionary });
  assert.deepEqual([e.categoryId, e.categoryConfidence, e.candidates], ["other", "low", ["other"]]);
  // Подсказка «кофе» против частого «кофе» в продуктах — ничья → low, кандидаты обе
  const d2 = buildDictionary(Array.from({ length: 5 }, (_, i) => exp(`кофе зерно ${i}`, "food")), "2026-10-20");
  const c = one("кофе 900", { dictionary: d2 });
  assert.equal(c.categoryConfidence, "low");
  assert.deepEqual(c.candidates.sort(), ["cafe", "food"]);
});

test("словарь: личные траты партнёра в него не попадают", () => {
  const e = (id, note, scope, authorId) => ({ id, amount: 1, currency: "RSD", rate: 1, base: 1, catId: "c", note, date: "2026-10-05", ts: 1, scope, authorId });
  const raw = {
    settings: { base: "RSD", currencies: ["RSD"], rates: {}, familyCategories: [], version: 1 },
    goals: null,
    userSettings: {},
    hashes: {
      "ft:m:2026-10": { f: e("f", "общий ужин", "family", "masha") },
      "ft:u:vlad:m:2026-10": { v: e("v", "мой велосипед", "personal", "vlad") },
      "ft:u:masha:m:2026-10": { m: e("m", "секретный подарок", "personal", "masha") },
    },
  };
  const dict = buildDictionary(visibleExpenses(buildView(raw, { id: "vlad", name: "В" }, { id: "masha", name: "М" })), "2026-10-20");
  assert.ok(dict["ужин"] && dict["велосипед"]);
  assert.equal(dict["секретный"], undefined);
  assert.equal(dict["подарок"], undefined);
});
