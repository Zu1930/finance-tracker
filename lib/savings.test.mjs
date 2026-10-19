// Тесты сбережений: итоги, сверка, динамика, копилки, приватность, миграция, смена базы. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocated, allocation, applyGoalOp, applyReconcile, buildSavings, flowsSince, gapStatus, goalDeleteError,
  migrateGoals, monthChange, monthEndSeries, rebaseRecon, reconcile, runway, toBase, totals,
} from "./savings.ts";
import { buildView } from "./store.ts";
import { needsGoalsMigration } from "./migrate.ts";
import { rebaseStore } from "./rebase.ts";

const vlad = { id: "vlad", name: "Влад" };
const masha = { id: "masha", name: "Маша" };
const rates = { EUR: 117, USD: 100, GBP: null };
const acc = (id, currency, balance, scope = "family", ownerId, extra = {}) =>
  ({ id, name: id, currency, scope, ...(ownerId && { ownerId }), balance, initial: balance, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "vlad", version: 1, ...extra });
const goal = (id, allocated, currency = "RSD", scope = "family", ownerId) =>
  ({ id, name: id, target: 100000, currency, allocated, scope, ...(ownerId && { ownerId }), ops: [], version: 1 });

test("toBase и totals: разные валюты, нет курса, архив", () => {
  assert.equal(toBase(100, "RSD", "RSD", rates), 100);
  assert.equal(toBase(10, "EUR", "RSD", rates), 1170);
  assert.equal(toBase(10, "GBP", "RSD", rates), null);
  assert.equal(toBase(10, "CHF", "RSD", rates), null);
  const t = totals([
    acc("cash", "RSD", 50000),
    acc("eur", "EUR", 100),
    acc("v", "USD", 10, "personal", "vlad"),
    acc("m", "RSD", 7000, "personal", "masha"),
    acc("gbp", "GBP", 5, "personal", "masha"),
    acc("old", "RSD", 999, "family", undefined, { archived: true }),
  ], "RSD", rates);
  assert.deepEqual(t, { family: 61700, byUser: { vlad: 1000, masha: 7000 }, all: 69700, missing: ["GBP"] });
});

const prev = { id: "r1", at: "2026-10-01T12:00:00.000Z", day: "2026-10-01", by: "vlad", balances: { cash: 100000, eur: 1000 }, rates: { EUR: 110 }, totals: { family: 210000, byUser: {}, all: 210000 }, income: null, expense: null, expected: null, fact: null, gap: null };
const meta = { id: "r2", at: "2026-10-15T09:00:00.000Z", day: "2026-10-15", by: "vlad" };

test("reconcile: первая сверка — точка отсчёта", () => {
  const r = reconcile(null, [acc("cash", "RSD", 100000)], "RSD", rates, null, meta);
  assert.equal(r.totals.all, 100000);
  assert.deepEqual([r.expected, r.fact, r.gap, r.income, r.expense], [null, null, null, null, null]);
  assert.equal(gapStatus({ gap: r.gap, expected: r.expected, income: r.income }), null);
});

test("reconcile: факт по текущему курсу — колебание курса и новый счёт не дают расхождения", () => {
  // EUR подорожал 110 → 117, остаток в EUR тот же; новый счёт открыт с 5000
  const accounts = [acc("cash", "RSD", 130000), acc("eur", "EUR", 1000), acc("new", "RSD", 5000)];
  const r = reconcile(prev, accounts, "RSD", rates, { income: 50000, expense: 20000 }, meta);
  assert.equal(r.fact, 30000);
  assert.equal(r.expected, 30000);
  assert.equal(r.gap, 0);
  assert.equal(r.totals.all, 130000 + 117000 + 5000);
  assert.equal(gapStatus(r).kind, "ok");
  // Счёт, пополненный после открытия, учитывается от initial
  const grown = reconcile(prev, [acc("cash", "RSD", 130000), acc("eur", "EUR", 1000), acc("new", "RSD", 8000, "family", undefined, { initial: 5000 })], "RSD", rates, { income: 53000, expense: 20000 }, meta);
  assert.equal(grown.gap, 0);
});

test("reconcile: расхождение в обе стороны, пороги 1% и 5%", () => {
  const accounts = (cash) => [acc("cash", "RSD", cash), acc("eur", "EUR", 1000)];
  // Ожидалось +30 000, по факту +20 000: незаписанная трата 10 000
  const lost = reconcile(prev, accounts(120000), "RSD", rates, { income: 50000, expense: 20000 }, meta);
  assert.equal(lost.gap, 10000);
  assert.deepEqual(gapStatus(lost), { kind: "expense", warn: true }); // 10 000 > 5% от 50 000
  // По факту больше ожидаемого: незаписанный доход
  const found = reconcile(prev, accounts(131500), "RSD", rates, { income: 50000, expense: 20000 }, meta);
  assert.equal(found.gap, -1500);
  assert.deepEqual(gapStatus(found), { kind: "income", warn: false }); // 1 500 ≤ 2 500
  // |gap| ≤ 1% ожидаемого — сходится
  assert.equal(gapStatus({ gap: 300, expected: 30000, income: 50000 }).kind, "ok");
  assert.equal(gapStatus({ gap: 301, expected: 30000, income: 50000 }).kind, "expense");
});

test("flowsSince: граница по дню и времени сверки, будущие даты не входят", () => {
  const t = (iso) => Date.parse(iso);
  const flows = [
    { kind: "income", base: 1000, date: "2026-09-30", ts: t("2026-10-02T00:00:00Z") }, // задним числом до сверки — уже в остатках
    { kind: "expense", base: 10, date: "2026-10-01", ts: t("2026-10-01T08:00:00Z") }, // в день сверки до неё
    { kind: "expense", base: 20, date: "2026-10-01", ts: t("2026-10-01T18:00:00Z") }, // в день сверки после неё
    { kind: "expense", base: 30, date: "2026-10-10", ts: t("2026-10-10T10:00:00Z") },
    { kind: "income", base: 500, date: "2026-10-14", ts: t("2026-10-14T10:00:00Z") },
    { kind: "expense", base: 999, date: "2026-10-20", ts: t("2026-10-14T10:00:00Z") }, // запланирована на будущее
  ];
  assert.deepEqual(flowsSince(flows, prev, "2026-10-15"), { income: 500, expense: 50 });
});

test("monthEndSeries: последний снимок месяца, пропуск переносится, текущий — сейчас", () => {
  const recons = [
    { at: "2026-06-30T10:00:00Z", day: "2026-06-30", all: 90 },
    { at: "2026-07-03T10:00:00Z", day: "2026-07-03", all: 100 },
    { at: "2026-07-28T10:00:00Z", day: "2026-07-28", all: 120 },
    { at: "2026-09-10T10:00:00Z", day: "2026-09-10", all: 150 },
  ];
  const s = monthEndSeries(recons, ["2026-07", "2026-08", "2026-09", "2026-10"], { key: "2026-10", value: 170 });
  assert.deepEqual(s, [
    { key: "2026-07", value: 120, carried: false },
    { key: "2026-08", value: 120, carried: true },
    { key: "2026-09", value: 150, carried: false },
    { key: "2026-10", value: 170, carried: false },
  ]);
  // До первого снимка — пусто, не перенос
  assert.deepEqual(monthEndSeries(recons.slice(3), ["2026-08", "2026-09"], { key: "2026-10", value: 0 })[0], { key: "2026-08", value: null, carried: false });
  assert.equal(monthChange(recons, "2026-10", 170), 20);
  assert.equal(monthChange([], "2026-10", 170), null);
});

test("копилки: распределение, свободно, запас; вернуть больше отведённого и удалить непустую нельзя", () => {
  const goals = [goal("a", 50000), goal("b", 100, "EUR"), goal("c", 10, "GBP")];
  assert.deepEqual(allocated(goals, "RSD", rates), { total: 61700, missing: ["GBP"] });
  assert.deepEqual(allocation(61700, 50000), { allocated: 61700, free: -11700 });
  assert.equal(runway(26000, 10000), 2.6);
  assert.equal(runway(26000, null), null);
  assert.equal(runway(26000, 0), null);
  const g = goal("g", 300);
  assert.equal(typeof applyGoalOp(g, -301, "vlad", "2026-10-15", 1, "o1"), "string");
  const ok = applyGoalOp(g, -300, "vlad", "2026-10-15", 1, "o1");
  assert.equal(ok.allocated, 0);
  assert.deepEqual(ok.ops, [{ id: "o1", amount: -300, date: "2026-10-15", ts: 1, by: "vlad" }]);
  assert.equal(goalDeleteError(g), "СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ");
  assert.equal(goalDeleteError(ok), null);
});

const rawSavings = () => ({
  accounts: { fam: acc("fam", "RSD", 100000) },
  userAccounts: {
    vlad: { vacc: acc("vacc", "EUR", 100, "personal", "vlad") },
    masha: { macc: acc("macc", "RSD", 7777, "personal", "masha", { name: "Секретный вклад Маши", updatedAt: "2026-09-01T10:00:00.000Z" }) },
  },
  goals: { gf: goal("gf", 1000) },
  userGoals: { vlad: { gv: goal("gv", 10, "EUR", "personal", "vlad") }, masha: { gm: { ...goal("gm", 3333, "RSD", "personal", "masha"), name: "Тайная цель Маши" } } },
  recons: [{ ...prev, balances: { fam: 90000, vacc: 100, macc: 5555 }, totals: { family: 90000, byUser: { vlad: 11000, masha: 5555 }, all: 106555 } }],
});

test("приватность: в ответе каждого нет личных счетов, копилок и поштучных остатков партнёра", () => {
  const raw = { settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [], version: 1 }, goals: null, userSettings: {}, hashes: {}, savings: rawSavings() };
  for (const [me, partner, hidden, partnerTotal, partnerGoals] of [
    [vlad, masha, ["macc", "Секретный вклад Маши", "gm", "Тайная цель Маши"], 7777, 3333],
    [masha, vlad, ["vacc", "gv"], 11700, 1170],
  ]) {
    const view = buildView(raw, me, partner);
    const json = JSON.stringify(view);
    for (const h of hidden) assert.ok(!json.includes(`"${h}"`) && !json.includes(h), `${h} в ответе ${me.id}`);
    assert.ok(!json.includes("balances"), "поштучные остатки снимка");
    assert.deepEqual(view.savings.partner.total, partnerTotal);
    assert.deepEqual(view.savings.partner.goalsAllocated, partnerGoals);
    assert.deepEqual(view.savings.accounts.family.map((a) => a.id), ["fam"]);
    assert.equal(view.savings.recons[0].all, 106555);
  }
  const v = buildView(raw, vlad, masha).savings;
  assert.deepEqual([v.recons[0].mine, v.recons[0].partner], [11000, 5555]);
  assert.equal(v.partner.lastUpdatedAt, "2026-09-01T10:00:00.000Z");
});

test("сверка: чужой личный счёт → 403, счета партнёра в снимке не меняются, устаревшая версия → 409", () => {
  const raw = rawSavings();
  const input = (balances, versions = Object.fromEntries(Object.keys(balances).map((id) => [id, 1]))) => ({ balances, versions, day: "2026-10-15" });
  const m = { id: "r2", at: "2026-10-15T09:00:00.000Z" };
  assert.equal(applyReconcile(raw, "vlad", input({ macc: 0 }), "RSD", rates, [], m).status, 403);
  assert.equal(applyReconcile(raw, "vlad", input({ fam: 1 }, { fam: 0 }), "RSD", rates, [], m).status, 409);
  const res = applyReconcile(raw, "vlad", input({ fam: 95000, vacc: 120 }), "RSD", rates, [], m);
  assert.deepEqual(res.changed.map((a) => [a.id, a.balance, a.updatedBy, a.version]), [["fam", 95000, "vlad", 2], ["vacc", 120, "vlad", 2]]);
  assert.equal(res.recon.balances.macc, 7777); // остаток Маши — как был у неё
  assert.equal(res.recon.totals.byUser.masha, 7777);
  assert.equal(res.recon.totals.all, 95000 + 120 * 117 + 7777);
});

test("миграция старых копилок: семейные, валюта сохраняется, повтор не нужен после флага", () => {
  const old = [
    { id: "g1", name: "Отпуск", target: 300000, ops: [{ id: "o1", amount: 200000, date: "2026-09-01", ts: 1 }, { id: "o2", amount: -20000, date: "2026-09-05", ts: 2 }] },
    { id: "g2", name: "Поездка", target: 2000, currency: "EUR", ops: [{ id: "o3", amount: 500, date: "2026-10-01", ts: 3 }] },
  ];
  const goals = migrateGoals(old, "RSD", "vlad");
  assert.deepEqual(goals.map((g) => [g.id, g.currency, g.allocated, g.scope, g.version]), [["g1", "RSD", 180000, "family", 1], ["g2", "EUR", 500, "family", 1]]);
  assert.deepEqual(goals[0].ops[1], { id: "o2", amount: -20000, date: "2026-09-05", ts: 2, by: "vlad" });
  // Тот же вход — тот же результат с теми же id: повторная запись через HSETNX ничего не задвоит
  assert.deepEqual(migrateGoals(old, "RSD", "vlad"), goals);
  const s = { base: "RSD", currencies: [], rates: {}, familyCategories: [], schemaVersion: 2, version: 1 };
  assert.equal(needsGoalsMigration(s, { items: old, version: 1 }), true);
  assert.equal(needsGoalsMigration({ ...s, schemaVersion: 3 }, { items: old, version: 1 }), false);
  assert.equal(needsGoalsMigration(s, { items: [], version: 1 }), false);
  assert.equal(needsGoalsMigration(null, { items: old, version: 1 }), false);
});

test("смена базы: снимки пересчитываются, копилки и счета в своих валютах не трогаются", () => {
  const savings = rawSavings();
  savings.recons[0] = { ...savings.recons[0], rates: { EUR: 117, USD: 100 }, income: 117000, expense: 58500, expected: 58500, fact: 46800, gap: 11700 };
  const raw = { settings: { base: "RSD", currencies: ["RSD", "EUR", "USD"], rates: { EUR: 117, USD: 100 }, familyCategories: [], version: 1 }, goals: null, userSettings: {}, hashes: {}, savings };
  const next = rebaseStore(raw, { from: "RSD", to: "EUR", rate: 117, limitRounding: 0 }, "2026-10-19");
  const r = next.savings.recons[0];
  assert.equal(r.totals.all, Math.round((106555 / 117) * 100) / 100);
  assert.deepEqual(r.totals.byUser, { vlad: Math.round((11000 / 117) * 100) / 100, masha: Math.round((5555 / 117) * 100) / 100 });
  assert.deepEqual([r.income, r.expense, r.expected, r.fact, r.gap], [1000, 500, 500, 400, 100]);
  assert.deepEqual(r.rates, { USD: 100 / 117, RSD: 1 / 117 });
  assert.deepEqual(r.balances, savings.recons[0].balances);
  assert.deepEqual(next.savings.goals, savings.goals);
  assert.deepEqual(next.savings.userGoals, savings.userGoals);
  assert.deepEqual(next.savings.userAccounts, savings.userAccounts);
  assert.ok(Math.abs(rebaseRecon(r, "EUR", "RSD", 1 / 117).totals.all - 106555) < 1); // туда-обратно — с точностью до округления
});
