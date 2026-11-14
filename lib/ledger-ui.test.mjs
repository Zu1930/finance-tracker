// Журнал на клиенте (lib/ledger-ui.ts): живой баланс моих счетов, итоги видов, счёт по умолчанию, история. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerHistory, ledgerTotals, myLedger, withDefaultAccount } from "./ledger-ui.ts";

const TODAY = "2026-11-14";
const acc = (id, currency, initial, extra = {}) => ({ id, name: id, currency, scope: "personal", ownerId: "vlad", balance: 0, initial, initialAt: "2026-11-01", updatedAt: "", updatedBy: "vlad", version: 1, ...extra });
const ex = (id, accountId, amount, extra = {}) => ({ id, amount, currency: "RSD", rate: 1, base: amount, catId: "c", note: "", date: "2026-11-05", ts: 5, scope: "personal", authorId: "vlad", accountId, accountAmount: amount, ...extra });

const data = (extra = {}) => ({
  me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" },
  settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [], version: 1 },
  myExpenses: { "2026-11": [ex("e1", "rsd", 1000)] },
  familyExpenses: { "2026-11": [ex("f1", "rsd", 500, { scope: "family", ts: 9 }), { ...ex("f2", undefined, 700, { scope: "family" }), authorId: "masha", accountId: undefined, accountAmount: undefined }] },
  incomes: { "2026-11": [{ id: "i1", amount: 100, currency: "EUR", rate: 117, base: 11700, sourceId: "s", note: "", date: "2026-11-02", ts: 2, authorId: "vlad", accountId: "eur", accountAmount: 100 }] },
  savings: {
    accounts: { family: [], mine: [acc("rsd", "RSD", 10000), acc("eur", "EUR", 50)] },
    goals: { family: [{ id: "trip", name: "Отпуск", target: 1000, currency: "EUR", allocated: 0, scope: "family", ops: [], version: 1 }], mine: [] },
    partner: { total: 0, goalsAllocated: 0, lastUpdatedAt: null }, recons: [],
    ledger: {
      since: "2026-11-01", allocs: [{ goalId: "trip", accountId: "eur", amount: 120, version: 1 }],
      // Сервер посчитал мои счета до последней записи: rsd ещё 10000
      accounts: { rsd: { balance: 10000, reserved: 0, free: 10000 }, eur: { balance: 150, reserved: 120, free: 30 } },
      goals: { trip: { total: 200, byUser: { vlad: 120, masha: 80 }, missing: [] } },
      familyTotal: 10000 + 150 * 117 + 30000, missing: [], moves: [], monthEnds: {},
    },
  },
  ...extra,
});

test("живой баланс: траты (и семейные мои), доходы; резерв превышает — overdrawn", () => {
  const d = data();
  const [rsd, eur] = myLedger(d, TODAY);
  assert.deepEqual([rsd.balance, rsd.free, rsd.inBase], [8500, 8500, 8500]);
  assert.deepEqual([eur.balance, eur.reserved, eur.free, eur.overdrawn], [150, 120, 30, false]);
  d.savings.ledger.allocs[0].amount = 200;
  assert.equal(myLedger(d, TODAY)[1].overdrawn, true);
});

test("итоги: личный — мои счета; семья — сумма с сервера, моя часть живая; цели — в личном только моя часть", () => {
  const d = data();
  const mine = myLedger(d, TODAY);
  const p = ledgerTotals(d, "personal", mine);
  assert.deepEqual([p.total, p.onGoals], [8500 + 150 * 117, 120 * 117]);
  const f = ledgerTotals(d, "family", mine);
  assert.equal(f.total, 8500 + 150 * 117 + 30000);
  assert.equal(f.onGoals, 200 * 117);
});

test("счёт по умолчанию — последний использованный; выбранный не меняется", () => {
  const d = data();
  assert.equal(withDefaultAccount(d, ex("n", undefined, 1)).accountId, "rsd");
  assert.equal(withDefaultAccount(d, ex("n", "eur", 1)).accountId, "eur");
});

test("история: месяцы после перехода — с сервера, текущий — живое", () => {
  const d = data();
  d.savings.ledger.since = "2026-09-15";
  d.savings.ledger.monthEnds = { "2026-09": { family: 900, mine: 400 }, "2026-10": { family: 1000, mine: 500 } };
  d.savings.recons = [{ at: "2026-08-20T10:00:00Z", day: "2026-08-20", all: 800, family: 0, mine: 300, partner: 0, income: null, expense: null, expected: null, fact: null, gap: null }];
  const s = ledgerHistory(d, "personal", ["2026-08", "2026-09", "2026-10", "2026-11"], 600);
  assert.deepEqual(s.map((x) => x.value), [300, 400, 500, 600]);
  assert.deepEqual(ledgerHistory(d, "family", ["2026-08", "2026-09"], 1).map((x) => x.value), [800, 1]);
});
