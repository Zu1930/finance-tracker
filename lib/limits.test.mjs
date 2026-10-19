// Лимиты по месяцам: правка действует с текущего месяца, прошлые месяцы не меняются. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { catsIn, limitIn, setLimit } from "./utils.ts";

test("лимит меняется с текущего месяца, прошлые помнят свой", () => {
  let c = { id: "c", name: "Кафе", limit: 100 };
  c = setLimit(c, 200, "2026-10");
  c = setLimit(c, 250, "2026-10"); // вторая правка за месяц не трогает историю
  c = setLimit(c, 0, "2026-12");
  assert.deepEqual(c.history, [{ until: "2026-09", limit: 100 }, { until: "2026-11", limit: 250 }]);
  assert.deepEqual(["2026-01", "2026-09", "2026-10", "2026-11", "2026-12", "2027-03"].map((k) => limitIn(c, k)), [100, 100, 250, 250, 0, 0]);
  // Созданная в этом месяце — без истории
  assert.equal(setLimit({ id: "n", name: "x", limit: 0, since: "2026-10" }, 50, "2026-10").history, undefined);
});

test("удалённая и новая категории видны только в своих месяцах", () => {
  const cats = [
    { id: "a", name: "A", limit: 10, archived: true, archivedFrom: "2026-10" },
    { id: "b", name: "B", limit: 20, since: "2026-10" },
    { id: "old", name: "Old", limit: 30, archived: true }, // удалена до истории: только где есть траты
  ];
  const ids = (key, spent = {}) => catsIn(cats, key, spent).map((c) => c.id);
  assert.deepEqual(ids("2026-09"), ["a"]);
  assert.deepEqual(ids("2026-09", { old: 5 }), ["a", "old"]);
  assert.deepEqual(ids("2026-10", { a: 5 }), ["b"]);
});

test("смена базы пересчитывает и прежние лимиты", async () => {
  const { rebaseSettings } = await import("./rebase.ts");
  const s = { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 100 }, version: 1,
    familyCategories: [{ id: "c", name: "Кафе", limit: 2000, history: [{ until: "2026-09", limit: 1000 }] }] };
  const [c] = rebaseSettings(s, { from: "RSD", to: "EUR", rate: 100, limitRounding: 0 }, "2026-10-19").familyCategories;
  assert.equal(c.limit, 20);
  assert.deepEqual(c.history, [{ until: "2026-09", limit: 10 }]);
});
