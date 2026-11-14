// Миграция на журнал (lib/ledger-migrate.ts) на PGlite: --dry ничего не пишет, перевод по правилам, повтор — без изменений.
// Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test/auth-kit.mjs";

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { migrateLedger, migrateHousehold, summary } = await import("./ledger-migrate.ts");
const { buildView } = await import("./store.ts");

const DAY = "2026-11-14";
const V = { userId: "vlad", householdId: "h1" }, M = { userId: "masha", householdId: "h1" };
const acc = (id, scope, ownerId, currency, balance, extra = {}) =>
  ({ id, name: id, currency, scope, ...(ownerId && { ownerId }), balance, initial: 0, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: "vlad", version: 1, ...extra });

async function oldFamily() {
  const { db, sql } = await freshDb(schema);
  const r = postgresRepos(db);
  await sql(`INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга');
    INSERT INTO households (id, name) VALUES ('h1', 'Семья'), ('h2', 'Ольга');
    INSERT INTO memberships (household_id, user_id, role, joined_at) VALUES ('h1', 'vlad', 'owner', '2026-01-01'), ('h1', 'masha', 'member', '2026-01-02'), ('h2', 'olga', 'owner', '2026-01-01');`);
  await r.settings.put(V, 0, { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 40000 }] });
  await r.accounts.create(V, acc("fam", "family", null, "RSD", 100000));
  await r.accounts.create(V, acc("veur", "personal", "vlad", "EUR", 500));
  await r.accounts.create(M, acc("mrsd", "personal", "masha", "RSD", 20000));
  await r.accounts.create(M, acc("mold", "personal", "masha", "RSD", 0, { archived: true }));
  await r.expenses.add(V, { id: "e1", amount: 1000, currency: "RSD", rate: 1, base: 1000, catId: "food", note: "", date: "2026-11-10", ts: 1, scope: "family", authorId: "vlad" });
  await r.incomes.add(M, { id: "i1", amount: 50000, currency: "RSD", rate: 1, base: 50000, sourceId: "s", note: "", date: "2026-11-05", ts: 2, authorId: "masha" });
  // Семейная: Влад 300, Маша 200, ещё 100 — без операций
  await r.goals.create(V, { id: "trip", name: "Отпуск", target: 2000, currency: "EUR", allocated: 600, scope: "family",
    ops: [{ id: "o1", amount: 300, date: "2026-09-01", ts: 1, by: "vlad" }, { id: "o2", amount: 250, date: "2026-09-02", ts: 2, by: "masha" }, { id: "o3", amount: -50, date: "2026-09-03", ts: 3, by: "masha" }], version: 1 });
  await r.goals.create(M, { id: "coat", name: "Пальто", target: 30000, currency: "RSD", allocated: 25000, scope: "personal", ownerId: "masha", ops: [], version: 1 });
  await r.recons.add(V, { id: "r1", at: "2026-10-01T10:00:00.000Z", day: "2026-10-01", by: "vlad", balances: {}, rates: {}, totals: { family: 1, byUser: {}, all: 1 }, income: null, expense: null, expected: null, fact: null, gap: null }, [], [], 0);
  // Ольга — бюджет на журнале с рождения: миграция его не трогает
  await sql(`UPDATE households SET ledger_since = '2026-11-01' WHERE id = 'h2'`);
  return { db, sql, r };
}

const dump = async (sql) => JSON.stringify(await Promise.all(["accounts", "expenses", "incomes", "goals", "goal_allocs", "households", "recons"].map((t) => sql(`SELECT * FROM ${t} ORDER BY 1, 2`))));

test("--dry: отчёт есть, база не меняется", async () => {
  const { db, sql } = await oldFamily();
  const before = await dump(sql);
  const reps = await migrateLedger(db, { day: DAY, dry: true });
  assert.deepEqual(reps.map((x) => [x.householdId, x.status]), [["h1", "migrated"]]);
  assert.equal(await dump(sql), before);
  assert.match(summary(reps, { day: DAY, dry: true }), /ПРОБНЫЙ ПРОГОН/);
});

test("перевод: общий счёт — владельцу, основной счёт, legacy, части целей по авторам, повтор — без изменений", async () => {
  const { db, sql, r } = await oldFamily();
  const [rep] = await migrateLedger(db, { day: DAY, dry: false });
  assert.deepEqual(rep.accounts.map((a) => [a.id, a.owner, a.initial, a.primary, a.fromFamily]).sort(), [
    ["fam", "Влад", 100000, true, true], ["mold", "Маша", 0, false, false], ["mrsd", "Маша", 20000, true, false], ["veur", "Влад", 500, false, false],
  ]);
  assert.deepEqual([rep.legacyExpenses, rep.legacyIncomes, rep.recons], [1, 1, 1]);
  assert.deepEqual(rep.allocs.map((x) => [x.goal, x.account, x.owner, x.amount]).sort(), [
    ["Отпуск", "mrsd", "Маша", 23400], ["Отпуск", "veur", "Влад", 400], ["Пальто", "mrsd", "Маша", 25000],
  ].sort());
  assert.ok(rep.warnings.some((w) => /Общий счёт «fam»/.test(w)));
  assert.ok(rep.warnings.some((w) => /Отпуск.*100 EUR без автора — отдано Влад/.test(w)));
  assert.ok(rep.warnings.some((w) => /mrsd.*меньше нуля/.test(w)), "у Маши под цели 48 400 при остатке 20 000");

  // Балансы — записанные остатки; старые записи не двигают; цель собрана целиком
  const view = buildView(await r.store.snapshot(V), { id: "vlad", name: "Влад" }, { id: "masha", name: "Маша" }, "2026-11", DAY);
  assert.deepEqual(view.savings.ledger.accounts.fam, { balance: 100000, reserved: 0, free: 100000 });
  assert.deepEqual(view.savings.ledger.accounts.veur, { balance: 500, reserved: 400, free: 100 });
  assert.equal(view.savings.ledger.goals.trip.total, 600);
  assert.deepEqual(view.savings.ledger.goals.trip.byUser, { vlad: 400, masha: 200 });
  assert.equal(view.savings.ledger.since, DAY);
  assert.equal(view.savings.accounts.family.length, 0, "общих счетов не осталось");
  assert.equal(view.savings.goals.family[0].allocated, 0);

  // Повтор: бюджет пропускается, база та же
  const after = await dump(sql);
  assert.deepEqual(await migrateLedger(db, { day: "2026-12-01", dry: false }), []);
  assert.equal((await migrateHousehold(db, "h1", { day: "2026-12-01", dry: false })).status, "skipped");
  assert.equal(await dump(sql), after);
});
