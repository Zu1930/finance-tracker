// Экспорт всех своих данных и удаление аккаунта. Запуск: npm run test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, caller } from "./test/auth-kit.mjs";

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { createAuth } = await import("./auth.ts");
const { importAuthUsers } = await import("./auth-admin.ts");
const { createInvite, acceptInvite } = await import("./family.ts");
const { archiveView } = await import("./archive.ts");
const { exportAll, deleteAccount, DELETED_NAME } = await import("./account.ts");
const { outbox } = await import("./mail.ts");
const { eq } = await import("drizzle-orm");

const T = "2026-10-20", CUR = "2026-10";
const PW = { vlad: "пароль-влада-123", masha: "пароль-маши-1234", petr: "пароль-петра-123" };
let db, sql, r, call, n = 0;
const ex = (who, scope) => ({ id: `x${++n}-${who}`, amount: 100, currency: "RSD", rate: 1, base: 100, catId: scope === "family" ? "food" : "c-" + who, note: `${scope}-${who}`, date: T, ts: 1_760_000_000_000 + n, scope, authorId: who });
const ctxOf = async (who) => ({ userId: who, householdId: await r.system.householdOf(who) });

beforeEach(async () => {
  ({ db, sql } = await freshDb(schema));
  r = postgresRepos(db);
  call = caller(createAuth(db));
  outbox.length = 0;
  await sql(`INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('petr', 'Пётр')`);
  await importAuthUsers(db, Object.entries(PW).map(([id, password]) => ({ id, email: `${id}@example.com`, password })));
});

async function pair() {
  const v = { userId: "vlad", householdId: await r.system.ensureHousehold("vlad") };
  await r.settings.put(v, 0, { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 1000 }] });
  await r.system.ensureHousehold("masha");
  await acceptInvite(db, (await createInvite(db, v)).code, "masha");
  for (const u of ["vlad", "masha"]) {
    const c = await ctxOf(u);
    await r.userSettings.put(c, 0, { personalCategories: [{ id: "c-" + u, name: "Личное-" + u, limit: 10 }] });
    await r.expenses.add(c, ex(u, "family"));
    await r.expenses.add(c, ex(u, "personal"));
    await r.accounts.create(c, { id: "acc-" + u, name: "Мой счёт-" + u, currency: "RSD", scope: "personal", ownerId: u, balance: 1, initial: 1, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: u, version: 1 });
    await r.apiTokens.add(c, "tok-" + u, { name: "iPhone", hash: "a".repeat(64), createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: null });
  }
  return v.householdId;
}

test("экспорт: профиль, мой бюджет и архивы — без личного партнёра", async () => {
  const F = await pair();
  const data = await exportAll(db, "vlad");
  assert.deepEqual([data.profile.id, data.profile.email, data.profile.name], ["vlad", "vlad@example.com", "Влад"]);
  const s = JSON.stringify(data);
  for (const mine of ["personal-vlad", "family-vlad", "family-masha", "Мой счёт-vlad", "Личное-vlad"]) assert.ok(s.includes(mine), mine);
  for (const theirs of ["personal-masha", "Мой счёт-masha", "Личное-masha", "masha@example.com", "tok-masha"]) assert.ok(!s.includes(theirs), `в экспорте ${theirs}`);
  assert.ok(!s.includes("password") && !s.includes("hash"), "ни хешей паролей, ни токенов");
  assert.deepEqual(data.archives, []);
  assert.equal(data.budget.names.masha, "Маша");
});

test("удаление: неверный пароль — отказ; из пары — выход по правилам, личное исчезает, в семейном — «Удалённый пользователь», вход невозможен", async () => {
  const F = await pair();
  assert.equal((await deleteAccount(db, "masha", "не тот")).status, 400);
  assert.equal((await call("/sign-in/email", { body: { email: "masha@example.com", password: PW.masha } })).status, 200, "после отказа всё на месте");

  assert.deepEqual(await deleteAccount(db, "masha", PW.masha), { ok: true });
  // Семья распущена по правилам выхода; у Маши ни действующего бюджета, ни личных данных
  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, F));
  assert.equal(h.status, "archived");
  assert.equal(await r.system.householdOf("masha"), null);
  for (const t of [schema.expenses, schema.accounts, schema.categories]) {
    const left = (await db.select().from(t)).filter((x) => x.ownerId === "masha");
    assert.deepEqual(left, [], "личного Маши не осталось");
  }
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, "masha"));
  assert.deepEqual([u.name, u.email, u.emailVerified], [DELETED_NAME, null, false]);
  for (const t of [schema.authAccounts, schema.authSessions, schema.apiTokens]) assert.deepEqual((await db.select().from(t)).filter((x) => x.userId === "masha"), []);
  assert.notEqual((await call("/sign-in/email", { body: { email: "masha@example.com", password: PW.masha } })).status, 200, "войти нельзя");

  // У Влада в архиве её семейная трата — от «удалённого пользователя»
  const a = await archiveView(db, "vlad", F);
  const e = a.familyExpenses[CUR].find((x) => x.authorId === "masha");
  assert.equal(e.note, "family-masha");
  assert.equal(a.names.masha, DELETED_NAME);
  assert.ok(!JSON.stringify(a).includes("personal-masha"));
  assert.deepEqual(outbox.map((m) => [m.to, m.subject]), [["masha@example.com", "Аккаунт удалён"]]);
});

test("удаление solo-пользователя: бюджет и все его строки удалены, чужое не тронуто", async () => {
  await pair();
  const p = { userId: "petr", householdId: await r.system.ensureHousehold("petr") };
  await r.settings.put(p, 0, { base: "EUR", currencies: ["EUR"], rates: {}, schemaVersion: 3, familyCategories: [] });
  await r.userSettings.put(p, 0, { personalCategories: [{ id: "c-petr", name: "Личное-petr", limit: 1 }] });
  await r.expenses.add(p, ex("petr", "personal"));
  await r.incomes.add(p, { id: "inc-petr", amount: 1, currency: "EUR", rate: 1, base: 1, sourceId: "salary", note: "", date: T, ts: 1, authorId: "petr" });
  assert.deepEqual(await deleteAccount(db, "petr", PW.petr), { ok: true });
  assert.equal((await db.select().from(schema.households).where(eq(schema.households.id, p.householdId))).length, 0);
  for (const t of [schema.expenses, schema.incomes, schema.categories, schema.userSettings, schema.memberships]) {
    assert.equal((await db.select().from(t).where(eq(t.householdId, p.householdId))).length, 0);
  }
  assert.equal((await r.system.members((await ctxOf("vlad")).householdId)).length, 2, "семья Влада и Маши на месте");
});
