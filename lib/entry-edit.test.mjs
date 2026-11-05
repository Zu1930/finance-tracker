// Правка записи на месте: что считается тем же, что отвязывается, кто может переносить. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { editExpense, sameEntry, unlinks } from "./entry-edit.ts";

const e = { id: "a", amount: 100, currency: "RSD", rate: 1, base: 100, catId: "food", note: "", date: "2026-11-02", ts: 5, scope: "family", authorId: "vlad" };

test("тот же или изменённый: сумма, категория, бюджет, дата, заметка", () => {
  assert.equal(sameEntry(e, { ...e }), true);
  for (const ch of [{ amount: 1 }, { catId: "x" }, { scope: "personal" }, { date: "2026-11-03" }, { note: "n" }, { currency: "EUR" }]) assert.equal(sameEntry(e, { ...e, ...ch }), false);
});

test("отвязка: категория и бюджет — план и регулярный; другой месяц — только план; сумма — ничего", () => {
  const linked = { ...e, planItemId: "p", recurringId: "r", recurringMonth: "2026-11" };
  assert.deepEqual(unlinks(linked, { ...linked, catId: "home" }), { plan: true, recurring: true });
  assert.deepEqual(unlinks(linked, { ...linked, scope: "personal" }), { plan: true, recurring: true });
  assert.deepEqual(unlinks(linked, { ...linked, date: "2026-12-01" }), { plan: true, recurring: false });
  assert.deepEqual(unlinks(linked, { ...linked, date: "2026-11-20" }), { plan: false, recurring: false });
  const r = editExpense(linked, { ...linked, amount: 5, planItemId: "other" }, "vlad");
  assert.equal(r.entry.planItemId, "p", "связь клиент не подменит");
  assert.equal(r.entry.recurringId, "r");
});

test("перенести между бюджетами может только автор; автор и время записи не меняются", () => {
  assert.deepEqual(editExpense(e, { ...e, scope: "personal" }, "masha"), { ok: false, status: 403, error: "Перенести чужую трату нельзя." });
  const r = editExpense(e, { ...e, scope: "personal", authorId: "masha", ts: 99 }, "vlad");
  assert.equal(r.entry.scope, "personal");
  assert.equal(r.entry.authorId, "vlad");
  assert.equal(r.entry.ts, 5);
});
