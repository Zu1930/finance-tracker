// Регулярные платежи: вхождения, сроки, цена по истории, статусы, план, лимиты, оплата, «к оплате», приватность, rebase.
// Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeIn, amountIn, dueDate, dueNow, endMonthOnDelete, matchPayment, occurrences, payLinkError, recurringTotal, withAmount } from "./recurring.ts";
import { planSpentByCat, planSummary } from "./plan.ts";
import { buildView } from "./store.ts";
import { rebaseStore } from "./rebase.ts";

const pay = (id, extra = {}) => ({
  id, name: id, currency: "RSD", approx: false, frequency: "monthly", day: 5, categoryId: "home", scope: "family",
  startMonth: "2026-01", paused: false, skips: [], amounts: [{ fromMonth: "2026-01", amount: 1000 }], createdBy: "vlad", version: 1, ...extra,
});
let n = 0;
const exp = (extra) => ({ id: `e${n++}`, amount: 1000, currency: "RSD", rate: 1, base: 1000, catId: "home", note: "", date: "2026-10-05", ts: n, scope: "family", authorId: "vlad", ...extra });
const rates = { EUR: 117 };

test("вхождения: ежемесячный, ежегодный, начало и конец, пауза, пропуск", () => {
  const m = pay("m", { startMonth: "2026-03", endMonth: "2026-11" });
  assert.deepEqual(["2026-02", "2026-03", "2026-11", "2026-12"].map((k) => activeIn(m, k)), [false, true, true, false]);
  const y = pay("y", { frequency: "yearly", month: 12 });
  assert.deepEqual(["2026-11", "2026-12", "2027-12"].map((k) => activeIn(y, k)), [false, true, true]);
  assert.equal(activeIn(pay("p", { paused: true }), "2026-10"), false);
  assert.equal(activeIn(pay("s", { skips: ["2026-10"] }), "2026-10"), false);
  assert.equal(activeIn(pay("s", { skips: ["2026-10"] }), "2026-11"), true);
});

test("срок: 31-е в 30-дневном месяце и в феврале, 29 февраля в невисокосный год", () => {
  assert.equal(dueDate(pay("a", { day: 31 }), "2026-11"), "2026-11-30");
  assert.equal(dueDate(pay("a", { day: 31 }), "2026-02"), "2026-02-28");
  assert.equal(dueDate(pay("a", { day: 31 }), "2028-02"), "2028-02-29");
  assert.equal(dueDate(pay("a", { day: 29 }), "2027-02"), "2027-02-28");
  assert.equal(dueDate(pay("a", { day: 5 }), "2026-10"), "2026-10-05");
});

test("история цены: новая сумма с fromMonth не меняет прошлые месяцы", () => {
  const p = withAmount(pay("net"), 1200, "2026-11");
  assert.deepEqual(["2026-09", "2026-10", "2026-11", "2027-01"].map((k) => amountIn(p, k)), [1000, 1000, 1200, 1200]);
  assert.deepEqual(withAmount(p, 1300, "2026-11").amounts.map((a) => a.amount), [1000, 1300]); // тот же месяц — замена
});

test("статусы относительно «сегодня»; итог: факт оплаченных + оценка остальных по текущему курсу", () => {
  const list = [pay("rent", { day: 1, currency: "EUR", amounts: [{ fromMonth: "2026-01", amount: 500 }] }), pay("net", { day: 20 }), pay("gas", { day: 10, approx: true, amounts: [{ fromMonth: "2026-01", amount: 8000 }] })];
  const paid = exp({ recurringId: "gas", recurringMonth: "2026-10", base: 8240, amount: 8240, date: "2026-10-12" });
  const occ = occurrences(list, "2026-10", [paid], "2026-10-15", "RSD", rates);
  assert.deepEqual(occ.map((o) => [o.paymentId, o.status, o.estimateBase]), [["rent", "overdue", 58500], ["gas", "paid", 8000], ["net", "upcoming", 1000]]);
  assert.equal(occ[1].paidBase, 8240);
  assert.equal(recurringTotal(occ), 58500 + 8240 + 1000);
  // Курса нет — оценка null, в итог не входит
  assert.equal(occurrences([pay("x", { currency: "GBP" })], "2026-10", [], "2026-10-01", "RSD", rates)[0].estimateBase, null);
});

test("план: остаток с учётом регулярных", () => {
  const s = planSummary({ income: 300000, familyLimits: 100000, myLimits: 20000, partnerLimits: 10000, items: [], partnerPlanned: 0, recurring: { family: 60000, mine: 2000, partner: 1500 } });
  assert.deepEqual(s.recurring, { family: 60000, mine: 2000, partner: 1500, total: 63500 });
  assert.equal(s.rest, 300000 - 63500 - 130000);
});

test("лимиты: оплата регулярного не входит в категорию, включая разницу факта и оценки", () => {
  const list = [exp({ base: 3000 }), exp({ base: 8240, recurringId: "gas", recurringMonth: "2026-10" })];
  assert.deepEqual(planSpentByCat(list, []), { home: 3000 });
});

test("оплата: чужой → 403, не та категория или месяц → 400, повтор → 409", () => {
  const p = pay("net");
  const e = { catId: "home", scope: "family", recurringMonth: "2026-10" };
  assert.equal(payLinkError(p, e, false), null);
  assert.equal(payLinkError(null, e, false).status, 403);
  assert.equal(payLinkError(p, { ...e, catId: "food" }, false).status, 400);
  assert.equal(payLinkError(pay("s", { skips: ["2026-10"] }), e, false).status, 400);
  assert.equal(payLinkError(pay("y", { frequency: "yearly", month: 3 }), e, false).status, 400);
  assert.equal(payLinkError(p, { ...e, planItemId: "x" }, false).status, 400);
  assert.equal(payLinkError(p, e, true).status, 409);
});

test("к оплате: просроченные и сегодняшние; прошлый месяц — только в первые 7 дней", () => {
  const list = [pay("net", { day: 20 }), pay("rent", { day: 1 }), pay("tv", { day: 25 })];
  assert.deepEqual(dueNow(list, [], "2026-10-20", "RSD", rates).map((o) => `${o.month}:${o.paymentId}`), ["2026-10:rent", "2026-10:net"]);
  // 3 ноября: октябрьские неоплаченные ещё видны, 8 ноября — уже нет
  const paidOct = [exp({ recurringId: "rent", recurringMonth: "2026-10" })];
  assert.deepEqual(dueNow(list, paidOct, "2026-11-03", "RSD", rates).map((o) => `${o.month}:${o.paymentId}`), ["2026-10:net", "2026-10:tv", "2026-11:rent"]);
  assert.deepEqual(dueNow(list, paidOct, "2026-11-08", "RSD", rates).map((o) => `${o.month}:${o.paymentId}`), ["2026-11:rent"]);
});

test("удаление и похожая ручная трата", () => {
  const p = pay("net", { day: 20 });
  assert.equal(endMonthOnDelete(p, "2026-10-15", []), "2026-09"); // в октябре не оплачен
  assert.equal(endMonthOnDelete(p, "2026-10-15", [exp({ recurringId: "net", recurringMonth: "2026-10" })]), "2026-10");
  const occ = dueNow([pay("net", { day: 1, amounts: [{ fromMonth: "2026-01", amount: 1990 }] })], [], "2026-10-15", "RSD", rates);
  assert.equal(matchPayment(occ, "home", 2100)?.paymentId, "net"); // в пределах 10%
  assert.equal(matchPayment(occ, "home", 2300), undefined);
  assert.equal(matchPayment(occ, "food", 1990), undefined);
});

const raw = () => ({
  settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [{ id: "home", name: "Дом", limit: 20000 }], version: 1 },
  goals: null,
  userSettings: { vlad: { personalCategories: [{ id: "fun", name: "Хобби", limit: 1 }], version: 1 }, masha: { personalCategories: [{ id: "beauty", name: "Красота", limit: 1 }], version: 1 } },
  hashes: {
    "ft:u:masha:m:2026-10": { m1: { ...exp({ recurringId: "ms", recurringMonth: "2026-10", base: 1500, amount: 1500, catId: "beauty", scope: "personal", authorId: "masha" }), id: "m1", date: "2026-10-03" } },
  },
  recurring: {
    family: { rent: pay("rent", { currency: "EUR", amounts: [{ fromMonth: "2026-01", amount: 500 }] }) },
    byUser: {
      vlad: { vs: pay("vs", { name: "Подписка Влада", scope: "personal", ownerId: "vlad", categoryId: "fun", amounts: [{ fromMonth: "2026-01", amount: 999 }] }) },
      masha: {
        ms: pay("ms", { name: "Тайная подписка", scope: "personal", ownerId: "masha", categoryId: "beauty", amounts: [{ fromMonth: "2026-01", amount: 1400 }] }),
        my: pay("my", { name: "Тайный ежегодный", scope: "personal", ownerId: "masha", categoryId: "beauty", frequency: "yearly", month: 11, amounts: [{ fromMonth: "2026-01", amount: 30, }], currency: "EUR" }),
      },
    },
  },
});

test("приватность: личные платежи партнёра не в ответе, его сумма верна", () => {
  const vlad = { id: "vlad", name: "Влад" }, masha = { id: "masha", name: "Маша" };
  const v = buildView(raw(), vlad, masha, "2026-10");
  const jv = JSON.stringify(v);
  for (const s of ["Тайная подписка", "Тайный ежегодный", '"ms"', '"my"']) assert.ok(!jv.includes(s), `${s} у Влада`);
  assert.deepEqual(v.recurring.family.map((p) => p.id), ["rent"]);
  assert.deepEqual(v.recurring.mine.map((p) => p.id), ["vs"]);
  assert.equal(v.partnerRecurring["2026-10"], 1500); // оплачено фактом
  assert.equal(v.partnerRecurring["2026-11"], 1400 + 30 * 117); // оценка + ежегодный в EUR по курсу
  assert.deepEqual(v.partnerRecurringDaily["2026-10"], { 3: 1500 });
  const jm = JSON.stringify(buildView(raw(), masha, vlad, "2026-10"));
  assert.ok(!jm.includes("Подписка Влада") && !jm.includes('"vs"'));
});

test("rebase не трогает суммы и валюты регулярных платежей", () => {
  const r = raw();
  const next = rebaseStore(r, { from: "RSD", to: "EUR", rate: 117, limitRounding: 0 }, "2026-10-20");
  // Пересчитанное хранилище не содержит платежей — writeStoreAtomic их не перепишет
  assert.equal(next.recurring, undefined);
  assert.deepEqual(r.recurring, raw().recurring);
});
