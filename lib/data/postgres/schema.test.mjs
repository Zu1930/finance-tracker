// Схема Postgres: миграции из drizzle/ применяются к чистой базе (PGlite), ограничения защищают данные.
// Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

async function fresh() {
  const client = new PGlite();
  await migrate(drizzle({ client }), { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
  await client.exec(`
    INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга');
    INSERT INTO households (id, name) VALUES ('h1', 'Семья'), ('h2', 'Другая');
    INSERT INTO memberships (household_id, user_id, role) VALUES ('h1', 'vlad', 'owner'), ('h1', 'masha', 'member'), ('h2', 'olga', 'owner');
    INSERT INTO recurring_payments (household_id, id, name, currency, approx, frequency, day, category_id, scope, start_month, paused, created_by, version)
      VALUES ('h1', 'rent', 'Аренда', 'EUR', false, 'monthly', 1, 'home', 'family', '2026-10', false, 'vlad', 1);
  `);
  return client;
}
const expense = (extra = "") => `INSERT INTO expenses (household_id, id, author_id, scope, owner_id, category_id, amount, currency, rate, base, date, ts${extra ? ", " + extra.split("=")[0] : ""})`;
const rejects = (db, sql, constraint) => assert.rejects(db.exec(sql), (e) => (assert.match(e.message, new RegExp(constraint)), true), constraint);

test("миграции применяются, данные с точностью: деньги 2 знака, курс — без потерь", async () => {
  const db = await fresh();
  await db.exec(`${expense()} VALUES ('h1', 'e1', 'vlad', 'family', NULL, 'food', 10.55, 'EUR', 0.008547008547008548, 1234.56, '2026-10-20', now())`);
  const { rows } = await db.query("SELECT amount::text, rate::text, base::text FROM expenses");
  assert.deepEqual(rows[0], { amount: "10.55", rate: "0.008547008547008548", base: "1234.56" });
});

test("ограничения: scope ⇔ owner, автор — участник бюджета, личное — только автора, двойная оплата", async () => {
  const db = await fresh();
  const v = (id, scope, owner, author = "vlad") => `VALUES ('h1', '${id}', '${author}', '${scope}', ${owner ? `'${owner}'` : "NULL"}, 'c', 1, 'RSD', 1, 1, '2026-10-20', now())`;
  await rejects(db, `${expense()} ${v("a", "personal", null)}`, "expenses_scope_owner");
  await rejects(db, `${expense()} ${v("b", "family", "vlad")}`, "expenses_scope_owner");
  await rejects(db, `${expense()} ${v("c", "personal", "masha")}`, "expenses_owner_is_author");
  await rejects(db, `${expense()} ${v("d", "family", null, "olga")}`, "expenses_author");
  const pay = (id) => `INSERT INTO expenses (household_id, id, author_id, scope, category_id, amount, currency, rate, base, date, ts, recurring_id, recurring_month)
    VALUES ('h1', '${id}', 'vlad', 'family', 'home', 500, 'EUR', 117, 58500, '2026-10-01', now(), 'rent', '2026-10')`;
  await db.exec(pay("p1"));
  await rejects(db, pay("p2"), "expenses_recurring_month");
  await rejects(db, pay("p3").replace("'rent'", "'nope'"), "expenses_recurring");
});

test("ключи: один id в разных бюджетах не конфликтует; категории семьи и личные с одним id", async () => {
  const db = await fresh();
  await db.exec(`${expense()} VALUES ('h1', 'same', 'vlad', 'family', NULL, 'c', 1, 'RSD', 1, 1, '2026-10-20', now())`);
  await db.exec(`${expense()} VALUES ('h2', 'same', 'olga', 'family', NULL, 'c', 1, 'RSD', 1, 1, '2026-10-20', now())`);
  await db.exec(`INSERT INTO categories (household_id, id, scope, owner_id, name, "limit", sort) VALUES
    ('h1', 'home', 'family', NULL, 'Дом', 1, 0), ('h1', 'home', 'personal', 'vlad', 'Мой дом', 1, 0), ('h1', 'home', 'personal', 'masha', 'Её дом', 1, 0)`);
  await rejects(db, `INSERT INTO categories (household_id, id, scope, owner_id, name, "limit", sort) VALUES ('h1', 'home', 'family', NULL, 'Дубль', 1, 1)`, "categories_key");
  await rejects(db, `INSERT INTO categories (household_id, id, scope, owner_id, name, "limit", sort) VALUES ('h1', 'x', 'personal', 'olga', 'X', 1, 1)`, "categories_owner");
});
