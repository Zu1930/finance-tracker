// Офлайн-очередь: записи из очереди поверх данных с сервера, без дублей. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueue, withEntry } from "./offline.ts";

const empty = { familyExpenses: {}, myExpenses: {}, incomes: {} };
const exp = (id, scope = "family", date = "2026-10-20") => ({ id, amount: 1, currency: "RSD", rate: 1, base: 1, catId: "c", note: "", date, ts: 1, scope, authorId: "vlad" });

test("очередь поверх данных: по группам, без дублей, повторное применение ничего не меняет", () => {
  const server = withEntry(empty, "expense", exp("a"), true);
  const q = [{ kind: "expense", entry: exp("b") }, { kind: "expense", entry: exp("p", "personal") }, { kind: "income", entry: { ...exp("i"), sourceId: "salary" } }, { kind: "expense", entry: exp("a") }];
  const d = applyQueue(server, q);
  assert.deepEqual(d.familyExpenses["2026-10"].map((e) => e.id), ["a", "b"]);
  assert.deepEqual(d.myExpenses["2026-10"].map((e) => e.id), ["p"]);
  assert.deepEqual(d.incomes["2026-10"].map((e) => e.id), ["i"]);
  assert.deepEqual(applyQueue(d, q), d);
});
