// Тесты переноса старых данных в семейный формат. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLegacy, needsMigration } from "./migrate.ts";

const exp = (id) => ({ id, amount: 100, currency: "RSD", rate: 1, base: 100, catId: "c1", note: "", date: "2026-10-10", ts: 1 });
const legacy = {
  settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117.2 }, categories: [{ id: "c1", name: "Продукты", limit: 40000 }], baseHistory: [] },
  goals: { items: [{ id: "g1", name: "Отпуск", target: 1000, ops: [] }] },
  "m-2026-09": { expenses: [exp("e1"), exp("e2")] },
  "m-2026-10": { expenses: [exp("e3")] },
  "i-2026-10": { items: [{ ...exp("i1"), sourceId: "salary" }] },
  "m-2026-08": { expenses: [] },
};

test("старые данные становятся семейными с автором MIGRATION_OWNER", () => {
  const raw = migrateLegacy(legacy, "vlad", ["vlad", "masha"]);
  assert.deepEqual(raw.settings.familyCategories, legacy.settings.categories);
  assert.ok(!("categories" in raw.settings));
  assert.equal(raw.settings.schemaVersion, 2);
  assert.deepEqual(Object.keys(raw.hashes).sort(), ["ft:i:2026-10", "ft:m:2026-09", "ft:m:2026-10"]);
  for (const e of Object.values(raw.hashes["ft:m:2026-09"])) {
    assert.equal(e.scope, "family");
    assert.equal(e.authorId, "vlad");
  }
  assert.equal(raw.hashes["ft:i:2026-10"].i1.authorId, "vlad");
  assert.deepEqual(raw.userSettings, { vlad: { personalCategories: [], version: 0 }, masha: { personalCategories: [], version: 0 } });
  assert.deepEqual(raw.goals.items, legacy.goals.items);
});

test("повторный запуск ничего не меняет: после переноса миграция не нужна", () => {
  assert.equal(needsMigration(null, legacy), true);
  const raw = migrateLegacy(legacy, "vlad", ["vlad", "masha"]);
  assert.equal(needsMigration(raw.settings, legacy), false);
  assert.equal(needsMigration(null, {}), false); // новая установка — нечего переносить
});
