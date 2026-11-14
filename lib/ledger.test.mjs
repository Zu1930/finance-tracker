// Тесты журнала: баланс из записей, резервы, цели, корректировка, приватность видов, история. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountState, adjustmentAmount, allocAfterSpend, balance, checkAlloc, familyView, goalProgress, historySeries,
  isFlow, mineView, monthEnd, reserved,
} from "./ledger.ts";

const acc = (id, ownerId, currency, initial = 0, extra = {}) => ({ id, ownerId, name: id, currency, initial, initialAt: "2026-11-01", version: 1, ...extra });
let n = 0;
const entry = (type, accountId, amount, day, extra = {}) =>
  ({ id: `e${++n}`, userId: "vlad", type, accountId, amount, scope: "personal", day, ts: n, ...extra });

const rates = { EUR: 117, USD: 100, GBP: null };
const TODAY = "2026-11-14";

test("баланс: доход, трата и перевод между валютами", () => {
  const rsd = acc("rsd", "vlad", "RSD", 10000);
  const eur = acc("eur", "vlad", "EUR", 100);
  const entries = [
    entry("income", "rsd", 50000, "2026-11-02"),
    entry("expense", "rsd", 3200.5, "2026-11-03"),
    // 11 700 RSD → 100 EUR: списано в валюте отправителя, зачислено в валюте получателя
    entry("transfer", "rsd", 11700, "2026-11-05", { toAccountId: "eur", toAmount: 100 }),
    entry("expense", "eur", 20, "2026-11-06", { origAmount: 2340, origCurrency: "RSD", rate: 117 }),
  ];
  assert.equal(balance(rsd, entries, TODAY), 10000 + 50000 - 3200.5 - 11700);
  assert.equal(balance(eur, entries, TODAY), 100 + 100 - 20);
});

test("перевод в одной валюте без toAmount и перевод на счёт партнёра", () => {
  const a = acc("a", "vlad", "RSD", 1000);
  const b = acc("b", "masha", "RSD", 0);
  const entries = [entry("transfer", "a", 400, "2026-11-10", { toAccountId: "b" })];
  assert.equal(balance(a, entries, TODAY), 600);
  assert.equal(balance(b, entries, TODAY), 400);
});

test("будущая запись — план, не в балансе; legacy и записи до initialAt — тоже", () => {
  const a = acc("a", "vlad", "RSD", 1000);
  const entries = [
    entry("expense", "a", 100, "2026-11-20"),
    entry("expense", "a", 200, "2026-11-10", { legacy: true }),
    entry("expense", "a", 300, "2026-10-31"),
    entry("income", "a", 50, TODAY),
  ];
  assert.equal(balance(a, entries, TODAY), 1050);
  // Наступил день плановой записи — она входит в баланс
  assert.equal(balance(a, entries, "2026-11-20"), 950);
  // До даты перехода — только initial
  assert.equal(balance(a, entries, "2026-10-15"), 1000);
});

test("корректировка: разница факта и баланса, со знаком; 0 — ничего не записывать", () => {
  const a = acc("a", "vlad", "RSD", 1000);
  const entries = [entry("expense", "a", 150, "2026-11-05")];
  const bal = balance(a, entries, TODAY);
  assert.equal(adjustmentAmount(900, bal), 50);
  assert.equal(adjustmentAmount(800, bal), -50);
  assert.equal(adjustmentAmount(850, bal), null);
  const adj = entry("adjustment", "a", adjustmentAmount(800, bal), TODAY);
  assert.equal(balance(a, [...entries, adj], TODAY), 800);
  // Корректировка — не доход и не трата
  assert.equal(isFlow(adj), false);
  assert.equal(isFlow(entry("transfer", "a", 1, TODAY, { toAccountId: "b" })), false);
  assert.equal(isFlow(entries[0]), true);
});

test("резерв: не больше free + текущей части, только со своего счёта", () => {
  const a = acc("a", "vlad", "RSD", 10000);
  const allocs = [{ goalId: "g1", accountId: "a", amount: 6000, version: 1 }, { goalId: "g2", accountId: "a", amount: 1000, version: 1 }];
  const st = accountState(a, [], allocs, TODAY);
  assert.deepEqual([st.balance, st.reserved, st.free], [10000, 7000, 3000]);
  assert.equal(checkAlloc({ next: 9000, current: 6000, free: st.free, accountOwnerId: "vlad", userId: "vlad" }), null);
  assert.match(checkAlloc({ next: 9000.01, current: 6000, free: st.free, accountOwnerId: "vlad", userId: "vlad" }), /Свободно только 9000/);
  assert.match(checkAlloc({ next: 100, current: 0, free: st.free, accountOwnerId: "masha", userId: "vlad" }), /своего счёта/);
  assert.equal(checkAlloc({ next: -1, current: 0, free: st.free, accountOwnerId: "vlad", userId: "vlad" }), "Неверная сумма.");
  // Вернуть всё можно всегда
  assert.equal(checkAlloc({ next: 0, current: 6000, free: -500, accountOwnerId: "vlad", userId: "vlad" }), null);
});

test("трата из цели уменьшает часть, не ниже 0; трата без отметки уводит free в минус", () => {
  const a = acc("a", "vlad", "RSD", 10000);
  let allocs = [{ goalId: "g", accountId: "a", amount: 8000, version: 1 }];
  const spend = entry("expense", "a", 5000, "2026-11-08", { goalId: "g" });
  allocs = allocs.map((p) => (p.goalId === spend.goalId && p.accountId === spend.accountId ? { ...p, amount: allocAfterSpend(p.amount, spend.amount), version: p.version + 1 } : p));
  assert.equal(reserved("a", allocs), 3000);
  assert.equal(accountState(a, [spend], allocs, TODAY).free, 2000);
  assert.equal(allocAfterSpend(3000, 4000), 0);
  // Без «из цели»: деньги ушли, резерв остался → свободно меньше нуля, UI предупреждает
  const st = accountState(a, [spend, entry("expense", "a", 4000, "2026-11-09")], allocs, TODAY);
  assert.equal(st.free, -2000);
  assert.equal(st.overdrawn, true);
});

test("прогресс цели — в валюте цели по текущему курсу, вклад по людям, счёт без курса не входит", () => {
  const accounts = [acc("v-rsd", "vlad", "RSD"), acc("m-eur", "masha", "EUR"), acc("m-usd", "masha", "USD"), acc("m-gbp", "masha", "GBP")];
  const goal = { id: "trip", name: "Отпуск", scope: "family", target: 2000, currency: "EUR" };
  const allocs = [
    { goalId: "trip", accountId: "v-rsd", amount: 23400, version: 1 },
    { goalId: "trip", accountId: "m-eur", amount: 300, version: 1 },
    { goalId: "trip", accountId: "m-usd", amount: 117, version: 1 },
    { goalId: "trip", accountId: "m-gbp", amount: 50, version: 1 },
    { goalId: "other", accountId: "m-eur", amount: 999, version: 1 },
  ];
  const p = goalProgress(goal, allocs, accounts, "RSD", rates);
  assert.equal(p.total, 200 + 300 + 100);
  assert.deepEqual(p.byUser, { vlad: 200, masha: 400 });
  assert.deepEqual(p.missing, ["GBP"]);
});

test("вид family не раскрывает личные траты партнёра; mine — только моё", () => {
  const accounts = [acc("v", "vlad", "RSD", 10000), acc("m", "masha", "RSD", 20000)];
  const secret = entry("expense", "m", 777, "2026-11-04", { userId: "masha", categoryId: "подарок-владу" });
  const famM = entry("expense", "m", 1500, "2026-11-05", { userId: "masha", scope: "family", categoryId: "еда" });
  const famV = entry("expense", "v", 500, "2026-11-06", { scope: "family", categoryId: "еда" });
  const incomeM = entry("income", "m", 40000, "2026-11-01", { userId: "masha", sourceId: "зарплата" });
  const goals = [
    { id: "home", name: "Ремонт", scope: "family", target: 100000, currency: "RSD" },
    { id: "m-own", name: "Секрет", scope: "personal", ownerId: "masha", target: 5000, currency: "RSD" },
    { id: "v-own", name: "Велосипед", scope: "personal", ownerId: "vlad", target: 5000, currency: "RSD" },
  ];
  const allocs = [
    { goalId: "home", accountId: "v", amount: 3000, version: 1 },
    { goalId: "home", accountId: "m", amount: 7000, version: 1 },
    { goalId: "m-own", accountId: "m", amount: 2000, version: 1 },
    { goalId: "v-own", accountId: "v", amount: 1000, version: 1 },
  ];
  const d = { me: "vlad", accounts, entries: [secret, famM, famV, incomeM], goals, allocs, base: "RSD", rates, today: TODAY };

  const fam = familyView(d);
  assert.equal(fam.total, (10000 - 500) + (20000 - 777 - 1500 + 40000));
  assert.deepEqual(fam.expenses.map((e) => e.id).sort(), [famM.id, famV.id].sort());
  assert.deepEqual(fam.goals.map((g) => g.goal.id), ["home"]);
  assert.deepEqual(fam.goals[0].byUser, { vlad: 3000, masha: 7000 });
  // Своя трата — со счётом, у трат партнёра счёта нет
  assert.equal(fam.expenses.find((e) => e.id === famV.id).accountId, "v");
  assert.equal(fam.expenses.find((e) => e.id === famM.id).accountId, undefined);
  const json = JSON.stringify(fam);
  for (const leak of [secret.id, "подарок-владу", "777", incomeM.id, "зарплата", "Секрет", '"m"']) assert.ok(!json.includes(leak), `в семейном виде: ${leak}`);

  const mine = mineView(d);
  assert.deepEqual(mine.accounts.map((s) => s.account.id), ["v"]);
  assert.equal(mine.total, 9500);
  assert.deepEqual(mine.goals.map((g) => g.goal.id), ["v-own"]);
  assert.deepEqual(mine.familyParts.map((p) => [p.goal.id, p.mine]), [["home", 3000]]);
  assert.ok(!JSON.stringify(mine).includes("Секрет"));
});

test("история: до перехода — снимки с carried, после — журнал на конец месяца, текущий — живое", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
  const snaps = [
    { day: "2026-05-20", at: "2026-05-20T10:00:00Z", value: 100 },
    { day: "2026-07-03", at: "2026-07-03T10:00:00Z", value: 150 },
    { day: "2026-07-25", at: "2026-07-25T10:00:00Z", value: 170 },
  ];
  const asked = [];
  const s = historySeries(months, { key: "2026-11", value: 999 }, "2026-09-10", snaps, (day) => (asked.push(day), day === "2026-09-30" ? 300 : 320));
  assert.deepEqual(s, [
    { key: "2026-06", value: 100, carried: true },
    { key: "2026-07", value: 170, carried: false },
    { key: "2026-08", value: 170, carried: true },
    { key: "2026-09", value: 300, carried: false },
    { key: "2026-10", value: 320, carried: false },
    { key: "2026-11", value: 999, carried: false },
  ]);
  assert.deepEqual(asked, ["2026-09-30", "2026-10-31"]);
  // До первого снимка — пусто
  assert.equal(historySeries(["2026-01"], { key: "2026-11", value: 0 }, null, [], () => 0)[0].value, null);
});
