// Доходы личные: миграция 0005 (корзина) идемпотентна, чужой доход не вернуть из корзины, не удалить и не изменить.
// Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const { postgresRepos } = await import("./postgres/repos.ts");
const schema = await import("./postgres/schema.ts");

const SQL = readFileSync(new URL("../../drizzle/0005_personal_incomes.sql", import.meta.url), "utf8");
const V = { userId: "vlad", householdId: "h" }, M = { userId: "masha", householdId: "h" };
const inc = (id, authorId) => ({ id, amount: 100, currency: "RSD", rate: 1, base: 100, sourceId: "salary", note: "", date: "2026-11-02", ts: 1, authorId });

async function setup() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await client.exec(`
    INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша');
    INSERT INTO households (id, name) VALUES ('h', 'Семья');
    INSERT INTO memberships (household_id, user_id, role) VALUES ('h', 'vlad', 'owner'), ('h', 'masha', 'member');
  `);
  return { client, r: postgresRepos(db) };
}

test("миграция 0005: удалённый доход в корзине получает владельца-автора; повторный запуск ничего не меняет", async () => {
  const { client, r } = await setup();
  // Как было до миграции: доход в корзине без владельца — «Вернуть» мог любой
  await client.query(`INSERT INTO deleted_entries (household_id, id, kind, owner_id, entry, expires_at) VALUES ('h', 'i1', 'income', NULL, $1, now() + interval '10 minutes')`, [JSON.stringify(inc("i1", "vlad"))]);
  const owner = async () => (await client.query(`SELECT owner_id FROM deleted_entries WHERE id = 'i1'`)).rows[0].owner_id;
  await client.exec(SQL);
  assert.equal(await owner(), "vlad");
  await client.exec(SQL);
  assert.equal(await owner(), "vlad", "второй запуск");
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM deleted_entries`)).rows[0].n, 1);
  assert.deepEqual(await r.trash.restore(M, "i1"), { ok: false, status: 403 }, "Маша не возвращает доход Влада");
  assert.equal((await r.trash.restore(V, "i1")).ok, true);
});

test("доход: партнёр не создаёт поверх, не меняет и не удаляет чужой (403); удалённый свой — в корзине с владельцем", async () => {
  const { r } = await setup();
  assert.equal(await r.incomes.add(V, inc("i2", "vlad")), true);
  assert.equal(await r.incomes.add(V, inc("i2", "vlad")), true, "повтор своей записи — можно");
  assert.equal(await r.incomes.add(M, inc("i2", "masha")), false);
  assert.equal((await r.incomes.update(M, "2026-11", inc("i2", "vlad"), { ...inc("i2", "vlad"), amount: 1 })).status, 403);
  assert.equal((await r.incomes.remove(M, "2026-11", "i2")).status, 403);
  const raw = await r.store.snapshot(V);
  assert.equal(raw.hashes["ft:i:2026-11"].i2.amount, 100, "доход Влада не тронут");
  assert.equal((await r.incomes.remove(V, "2026-11", "i2")).ok, true);
  assert.deepEqual(await r.trash.restore(M, "i2"), { ok: false, status: 403 });
});
