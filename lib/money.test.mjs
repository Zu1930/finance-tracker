// «Деньги»: обновление остатков (так же, запись «неучтено», отмена), давность, история. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReconcile, reconView } from "./savings.ts";
import { daysSince, isStale, moneySeries, otherId, unrecordedEntry, verdict } from "./money.ts";

const acc = (id, balance, scope = "family", ownerId) =>
  ({ id, name: id, currency: "RSD", scope, ...(ownerId && { ownerId }), balance, initial: balance, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "vlad", version: 1 });
// Прошлое обновление 01.10: семья 100 000, у Влада 50 000, у Маши 20 000
const prev = { id: "r1", at: "2026-10-01T12:00:00.000Z", day: "2026-10-01", by: "vlad", balances: { fam: 100000, v: 50000, m: 20000 }, rates: {}, totals: { family: 100000, byUser: { vlad: 50000, masha: 20000 }, all: 170000 }, income: null, expense: null, expected: null, fact: null, gap: null };
// С тех пор: семья потратила 30 000 (на счетах стало 70 000), пришло 10 000 Владу — а записано трат только на 20 000
const raw = () => ({
  accounts: { fam: acc("fam", 70000) },
  userAccounts: { vlad: { v: acc("v", 60000, "personal", "vlad") }, masha: { m: acc("m", 20000, "personal", "masha") } },
  goals: {}, userGoals: {}, recons: [prev],
});
const flow = (kind, base, date = "2026-10-10") => ({ kind, base, date, ts: Date.parse(`${date}T10:00:00Z`) });
const flows = [flow("income", 10000), flow("expense", 20000)];
const day = "2026-11-04";
const meta = { id: "r2", at: "2026-11-04T10:00:00.000Z" };
// Мастер: по каждому счёту, который можно обновлять, — введённый остаток или «так же» (прошлое значение)
const check = (r, balances, fl = flows) => {
  const res = applyReconcile(r, "vlad", { balances, versions: Object.fromEntries(Object.keys(balances).map((id) => [id, 1])), day }, "RSD", {}, fl, meta);
  assert.ok(!("error" in res), res.error);
  return reconView(res.recon, "vlad", "masha");
};

test("«так же» на всех счетах даёт текущий результат проверки", () => {
  const r = raw();
  const same = check(r, { fam: 70000, v: 60000 });
  // Ожидалось +10 000 − 20 000 = −10 000; на деле −30 000 + 10 000 = −20 000 → не записано 10 000
  assert.equal(same.expected, -10000);
  assert.equal(same.fact, -20000);
  assert.equal(same.gap, 10000);
  assert.deepEqual(verdict(same), { kind: "missing", gap: 10000 });
  // Без передачи остатков (ничего не трогали) — тот же снимок
  assert.deepEqual(check(r, {}), same);
});

test("запись «неучтено»: трата нужной суммы в выбранной категории бюджета, после неё — «сходится»; отмена возвращает разницу", () => {
  const r = raw();
  const before = check(r, { fam: 70000, v: 60000 });
  const cats = [{ id: "food", name: "Еда", limit: 1 }, { id: "etc", name: "Прочее", limit: 1 }];
  assert.equal(otherId(cats), "etc", "«Прочее» выбрано заранее");
  const fix = unrecordedEntry(before.gap, { scope: "family", to: otherId(cats), base: "RSD", today: day, ddmm: "04.11", id: "x1", ts: Date.parse("2026-11-04T11:00:00Z") });
  assert.equal(fix.kind, "expense");
  assert.deepEqual(
    { amount: fix.entry.amount, base: fix.entry.base, catId: fix.entry.catId, scope: fix.entry.scope, date: fix.entry.date, note: fix.entry.note },
    { amount: 10000, base: 10000, catId: "etc", scope: "family", date: day, note: "неучтено, обновление остатков 04.11" },
  );
  const after = check(r, { fam: 70000, v: 60000 }, [...flows, flow("expense", fix.entry.base, fix.entry.date)]);
  assert.equal(verdict(after).kind, "ok");
  // Отмена — трата удалена, разница снова на месте
  assert.deepEqual(verdict(check(r, { fam: 70000, v: 60000 }, flows)), { kind: "missing", gap: 10000 });
  // Личный бюджет — личная трата в выбранной категории; без «Прочего» заранее ничего не выбрано
  assert.equal(otherId([{ id: "a", name: "Кафе", limit: 1 }, { id: "b", name: "Хобби", limit: 1 }]), null);
  const mine = unrecordedEntry(500, { scope: "personal", to: "a", base: "RSD", today: day, ddmm: "04.11", id: "x2", ts: 1 });
  assert.equal(mine.entry.scope, "personal");
  assert.equal(mine.entry.catId, "a");
});

test("денег больше — доход «Прочее»; разница ≈ 0 и пустые категории — нечего записывать", () => {
  const r = raw();
  const more = check(r, { fam: 90000, v: 60000 });
  assert.equal(verdict(more).kind, "extra");
  const fix = unrecordedEntry(more.gap, { scope: "family", to: otherId([{ id: "salary", name: "Зарплата" }, { id: "other", name: "прочее" }]), base: "RSD", today: day, ddmm: "04.11", id: "x3", ts: 1 });
  assert.equal(fix.kind, "income");
  assert.equal(fix.entry.sourceId, "other");
  assert.equal(fix.entry.amount, 10000);
  assert.equal(verdict(check(r, { fam: 90000, v: 60000 }, [...flows, flow("income", 10000, day)])).kind, "ok");
  assert.equal(unrecordedEntry(0, { scope: "family", to: "a", base: "RSD", today: day, ddmm: "", id: "", ts: 0 }), null);
  assert.equal(unrecordedEntry(10, { scope: "family", to: null, base: "RSD", today: day, ddmm: "", id: "", ts: 0 }), null, "категория не выбрана");
  assert.equal(otherId([]), null);
});

test("первое обновление — точка отсчёта; давность: больше 14 дней или не было — карточка", () => {
  assert.deepEqual(verdict({ gap: null, expected: null, income: null }), { kind: "first" });
  assert.equal(daysSince(undefined, day), null);
  assert.equal(daysSince("2026-10-01", day), 34);
  assert.equal(isStale(null), true);
  assert.equal(isStale(14), false);
  assert.equal(isStale(15), true);
});

test("как менялось: остаток бюджета на конец месяца — семья, моё, всё", () => {
  const recons = [
    { at: "2026-09-30T10:00:00Z", day: "2026-09-30", all: 300, family: 200, mine: 60, partner: 40 },
    { at: "2026-10-20T10:00:00Z", day: "2026-10-20", all: 330, family: 210, mine: 70, partner: 50 },
  ];
  const months = ["2026-09", "2026-10", "2026-11"];
  assert.deepEqual(moneySeries(recons, "family", months, 215).map((p) => p.value), [200, 210, 215]);
  assert.deepEqual(moneySeries(recons, "personal", months, 80).map((p) => p.value), [60, 70, 80]);
  assert.deepEqual(moneySeries(recons, "all", months, 999).map((p) => p.value), [300, 330, 999]);
});
