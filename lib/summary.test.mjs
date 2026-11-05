// «Итоги»: сравнение на тот же день месяца, пороги 3 / 5 / 15 %, категория для фразы, без истории. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bars, deltaOf, historyMonths, limitExtremes, showRecap, summary, REQUIRED } from "./summary.ts";

const today = "2026-11-04";
let n = 0;
const ex = (date, catId, base, extra = {}) => ({ id: `e${n++}`, amount: base, currency: "RSD", rate: 1, base, catId, note: "", date, ts: 1, scope: "family", authorId: "vlad", ...extra });
const data = (familyExpenses, extra = {}) => ({
  familyExpenses, myExpenses: {}, incomes: {}, partnerPersonalTotals: {}, partnerPersonalDaily: {}, plans: {}, ...extra,
});
// Прошлые три месяца: 1–4 числа по 1000 на еду, после 4-го — ещё по 9000 (не должны попасть в сравнение)
const past = (food = 1000, home = 0) => ({
  "2026-08": [ex("2026-08-02", "food", food), ...(home ? [ex("2026-08-03", "home", home)] : []), ex("2026-08-20", "food", 9000)],
  "2026-09": [ex("2026-09-04", "food", food), ...(home ? [ex("2026-09-03", "home", home)] : []), ex("2026-09-05", "food", 9000)],
  "2026-10": [ex("2026-10-01", "food", food), ...(home ? [ex("2026-10-03", "home", home)] : []), ex("2026-10-30", "food", 9000)],
});

test("4 ноября сравнивается с 1–4 числом трёх прошлых месяцев, а не с ними целиком", () => {
  const s = summary(data({ ...past(), "2026-11": [ex("2026-11-03", "food", 1020)] }), "2026-11", today);
  assert.equal(s.current, true);
  assert.equal(s.untilDay, 4);
  assert.equal(s.spent, 1020);
  assert.equal(s.avg, 1000);
  assert.deepEqual(s.headline, { kind: "usual", pct: 2, key: null });
  assert.deepEqual(historyMonths(data(past()), "2026-11", today), ["2026-08", "2026-09", "2026-10"]);
});

test("порог 3 %: 3 % — как обычно, 4 % — дороже; категория — с наибольшим превышением в деньгах", () => {
  const usual = summary(data({ ...past(1000, 1000), "2026-11": [ex("2026-11-02", "food", 1030), ex("2026-11-02", "home", 1030)] }), "2026-11", today);
  assert.equal(usual.headline.kind, "usual");
  // Еда +100 (+10 %), дом −20: всего +4 % — «дороже, в основном из-за еды»
  const more = summary(data({ ...past(1000, 1000), "2026-11": [ex("2026-11-02", "food", 1100), ex("2026-11-02", "home", 980)] }), "2026-11", today);
  assert.deepEqual(more.headline, { kind: "more", pct: 4, key: "family:food" });
  // Дешевле: дом −600 больше, чем еда −100 — «особенно дом»
  const less = summary(data({ ...past(1000, 1000), "2026-11": [ex("2026-11-02", "food", 900), ex("2026-11-02", "home", 400)] }), "2026-11", today);
  assert.deepEqual(less.headline, { kind: "less", pct: 35, key: "family:home" });
});

test("прошлый месяц — весь месяц против трёх месяцев до него; строки по убыванию с долей", () => {
  const d = data({ ...past(), "2026-07": [ex("2026-07-10", "food", 10000)], "2026-10": [ex("2026-10-01", "food", 6000), ex("2026-10-30", "home", 4000)] });
  const s = summary(d, "2026-10", today);
  assert.equal(s.current, false);
  assert.equal(s.untilDay, undefined);
  assert.equal(s.spent, 10000);
  assert.equal(s.avg, 10000); // июль, август, сентябрь — по 10 000
  assert.deepEqual(s.rows.map((r) => [r.key, r.share]), [["family:food", 60], ["family:home", 40]]);
  assert.equal(s.rows[0].delta, -40);
  assert.equal(s.rows[1].delta, null, "дома раньше не было — сравнивать не с чем");
});

test("пороги строк: < 5 % — ≈ обычно, от 5 % — ▲/▼, от 15 % — предупреждение", () => {
  assert.deepEqual(deltaOf({ delta: 4 }), { kind: "same", pct: 4, warn: false });
  assert.deepEqual(deltaOf({ delta: -4 }), { kind: "same", pct: -4, warn: false });
  assert.deepEqual(deltaOf({ delta: 5 }), { kind: "up", pct: 5, warn: false });
  assert.deepEqual(deltaOf({ delta: 14 }), { kind: "up", pct: 14, warn: false });
  assert.deepEqual(deltaOf({ delta: 15 }), { kind: "up", pct: 15, warn: true });
  assert.deepEqual(deltaOf({ delta: -30 }), { kind: "down", pct: 30, warn: false });
  assert.equal(deltaOf({ delta: null }), null);
});

test("без истории — без фразы и без сравнения; регулярные — одной строкой «Обязательные»", () => {
  const s = summary(data({ "2026-11": [ex("2026-11-01", "food", 500), ex("2026-11-02", "home", 7000, { recurringId: "rent", recurringMonth: "2026-11" })] }), "2026-11", today);
  assert.equal(s.avg, null);
  assert.equal(s.headline, null);
  assert.deepEqual(s.rows.map((r) => [r.key, r.delta]), [[REQUIRED, null], ["family:food", null]]);
});

test("итоги прошлого месяца: только первые 7 дней; крупнейшие перерасход и экономия по лимитам", () => {
  assert.equal(showRecap("2026-11-07"), true);
  assert.equal(showRecap("2026-11-08"), false);
  const cats = [{ id: "food", name: "Еда", limit: 1000 }, { id: "gifts", name: "Подарки", limit: 100 }, { id: "car", name: "Транспорт", limit: 5000 }];
  const d = data({ "2026-10": [ex("2026-10-02", "food", 900), ex("2026-10-03", "gifts", 900), ex("2026-10-04", "car", 1600)] });
  assert.deepEqual(limitExtremes(d, "2026-10", [{ scope: "family", cats }]), { over: { key: "family:gifts", v: 800 }, saved: { key: "family:car", v: 3400 } });
});

test("по месяцам: шесть месяцев до текущего, траты и доход", () => {
  const d = data({ "2026-10": [ex("2026-10-02", "food", 900)] }, { incomes: { "2026-10": [{ base: 5000, date: "2026-10-01" }] } });
  const b = bars(d, today);
  assert.deepEqual(b.map((x) => x.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(b[4], { key: "2026-10", expense: 900, income: 5000 });
});
