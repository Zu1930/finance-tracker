// Вход через Better Auth на PGlite: перенос пользователей, вход, лимит, сессии, смена пароля, токены Быстрых команд.
// Запуск: npm run test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const ORIGIN = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.BETTER_AUTH_URL = ORIGIN;
const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { createAuth, sessionCtx } = await import("./auth.ts");
const { importAuthUsers, parseMigrateUsers, resetPassword } = await import("./auth-admin.ts");
const { handleQuick, newToken, hashToken } = await import("./quick-entry/api.ts");

const PW = { vlad: "старый-пароль-влада", masha: "short", olga: "пароль-ольги-123" };
const env = { PASSWORD_VLAD: PW.vlad, PASSWORD_MASHA: PW.masha, PASSWORD_OLGA: PW.olga };
const LIST = parseMigrateUsers("vlad:Vlad@Example.com, masha:masha@example.com, olga:olga@example.com", env);

let db, auth, repos, ipN = 0;
beforeEach(async () => {
  const client = new PGlite();
  db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await client.exec(`
    INSERT INTO users (id, name) VALUES ('vlad', 'Влад'), ('masha', 'Маша'), ('olga', 'Ольга');
    INSERT INTO households (id, name) VALUES ('default', 'Семья'), ('h2', 'Другая');
    INSERT INTO memberships (household_id, user_id, role, joined_at) VALUES
      ('default', 'vlad', 'owner', '2026-01-01'), ('default', 'masha', 'member', '2026-01-02'), ('h2', 'olga', 'owner', '2026-01-01');
  `);
  auth = createAuth(db);
  repos = postgresRepos(db);
});

/** Запрос к Better Auth как из браузера; у каждого вызова свой IP, если не задан — лимит проверяется отдельно */
async function call(path, { body, cookie, ip = `10.0.0.${++ipN % 250}`, method = body ? "POST" : "GET" } = {}) {
  const headers = { origin: ORIGIN, "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (iPhone) Safari" };
  if (body) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { method, headers, body: body && JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const signIn = (email, password, ip) => call("/sign-in/email", { body: { email, password }, ip });
const ctxOf = (cookie) => sessionCtx(auth, repos, new Headers(cookie ? { cookie } : {}));
async function login(id) {
  const r = await signIn(`${id}@example.com`, PW[id]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookie;
}

test("перенос пользователей: пробный ничего не пишет, вход со старым паролем, повтор пароль не трогает", async () => {
  const dry = await importAuthUsers(db, LIST, { dryRun: true });
  assert.deepEqual(dry.map((r) => r.password), ["задан", "задан", "задан"]);
  assert.equal((await db.select().from(schema.authAccounts)).length, 0, "после --dry-run пусто");
  assert.equal((await signIn("vlad@example.com", PW.vlad)).status, 401);

  await importAuthUsers(db, LIST);
  const users = await db.select().from(schema.users);
  assert.deepEqual(users.map((u) => [u.id, u.email, u.emailVerified]).sort(), [["masha", "masha@example.com", true], ["olga", "olga@example.com", true], ["vlad", "vlad@example.com", true]]);
  const ok = await signIn("vlad@example.com", PW.vlad);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.id, "vlad", "тот же id");
  assert.equal(ok.json.user.name, "Влад");
  assert.equal((await signIn("masha@example.com", PW.masha)).status, 200, "короткий старый пароль тоже входит");

  // Пароль сменили в приложении — повторный запуск скрипта его не возвращает
  assert.equal((await call("/change-password", { body: { currentPassword: PW.vlad, newPassword: "новый-пароль-1" }, cookie: ok.cookie })).status, 200);
  const again = await importAuthUsers(db, LIST);
  assert.deepEqual(again.map((r) => [r.id, r.password, r.emailChanged]), [["vlad", "уже был", false], ["masha", "уже был", false], ["olga", "уже был", false]]);
  assert.equal((await signIn("vlad@example.com", "новый-пароль-1")).status, 200);
  assert.equal((await db.select().from(schema.authAccounts)).length, 3, "без дублей");

  await assert.rejects(importAuthUsers(db, parseMigrateUsers("nobody:n@example.com", { PASSWORD_NOBODY: "x" })), /нет в users/);
  await assert.rejects(importAuthUsers(db, parseMigrateUsers("masha:vlad@example.com", env)), /уже у пользователя vlad/);
  assert.throws(() => parseMigrateUsers("vlad:v@example.com", {}), /PASSWORD_VLAD/);
  assert.throws(() => parseMigrateUsers("vlad", env), /id:email/);
});

test("вход: неверный пароль и несуществующий email — одинаковый ответ; регистрации нет", async () => {
  await importAuthUsers(db, LIST);
  const wrong = await signIn("vlad@example.com", "не тот");
  const none = await signIn("nobody@example.com", PW.vlad);
  assert.equal(wrong.status, 401);
  assert.deepEqual([none.status, none.json], [wrong.status, wrong.json]);
  assert.equal(wrong.cookie, "", "без cookie");
  const up = await call("/sign-up/email", { body: { email: "new@example.com", password: "пароль-новичка", name: "Новый" } });
  assert.notEqual(up.status, 200);
  assert.equal((await db.select().from(schema.users)).length, 3);
});

test("лимит попыток входа: 5 в минуту с одного IP, затем 429 даже с верным паролем; другой IP не задет", async () => {
  await importAuthUsers(db, LIST);
  for (let i = 0; i < 5; i++) assert.equal((await signIn("vlad@example.com", "не тот", "10.9.9.9")).status, 401);
  const blocked = await signIn("vlad@example.com", PW.vlad, "10.9.9.9");
  assert.equal(blocked.status, 429);
  assert.equal((await signIn("vlad@example.com", PW.vlad, "10.9.9.10")).status, 200);
  assert.ok((await db.select().from(schema.authRateLimits)).length >= 2, "счётчики в базе");
});

test("сессия: контекст с бюджетом; без cookie, после выхода и после «выйти везде» — нет доступа", async () => {
  await importAuthUsers(db, LIST);
  const phone = await login("vlad"), laptop = await login("vlad");
  assert.deepEqual(await ctxOf(phone), { userId: "vlad", householdId: "default" });
  assert.deepEqual(await ctxOf(await login("olga")), { userId: "olga", householdId: "h2" });
  assert.equal(await ctxOf(null), null);
  assert.equal(await ctxOf("better-auth.session_token=forged.value"), null);

  const list = await call("/list-sessions", { cookie: phone });
  assert.equal(list.json.length, 2);
  assert.match(list.json[0].userAgent, /iPhone/);

  assert.equal((await call("/revoke-other-sessions", { body: {}, cookie: phone })).status, 200);
  assert.equal(await ctxOf(laptop), null, "другая сессия завершена");
  assert.ok(await ctxOf(phone), "эта осталась");

  assert.equal((await call("/sign-out", { body: {}, cookie: phone })).status, 200);
  assert.equal(await ctxOf(phone), null, "после выхода");

  // Завершить одну сессию из списка
  const a = await login("masha"), b = await login("masha");
  const [first] = (await call("/list-sessions", { cookie: a })).json;
  assert.equal((await call("/revoke-session", { body: { token: first.token }, cookie: a })).status, 200);
  assert.deepEqual([!!(await ctxOf(a)), !!(await ctxOf(b))].sort(), [false, true]);
});

test("пользователь без бюджета не получает контекст", async () => {
  await importAuthUsers(db, LIST);
  const cookie = await login("olga");
  await db.delete(schema.memberships).where((await import("drizzle-orm")).eq(schema.memberships.userId, "olga"));
  assert.equal(await ctxOf(cookie), null);
});

test("изоляция с новой авторизацией: контекст сессии не видит чужой бюджет", async () => {
  await importAuthUsers(db, LIST);
  const vlad = await ctxOf(await login("vlad")), olga = await ctxOf(await login("olga"));
  await repos.settings.put(vlad, 0, { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 1 }] });
  await repos.expenses.add(vlad, { id: "x1", amount: 100, currency: "RSD", rate: 1, base: 100, catId: "food", note: "", date: "2026-10-20", ts: 1, scope: "family", authorId: "vlad" });
  const theirs = await repos.store.snapshot(olga);
  assert.equal(theirs.settings, null);
  assert.equal(JSON.stringify(theirs).includes("x1"), false);
  assert.equal(JSON.stringify(await repos.store.snapshot(vlad)).includes("x1"), true);
  assert.deepEqual((await repos.system.members(vlad.householdId)).map((u) => u.id), ["vlad", "masha"]);
});

test("смена пароля: со старым входить нельзя, текущая сессия остаётся, другие завершены; минимум 10 символов", async () => {
  await importAuthUsers(db, LIST);
  const cur = await login("vlad"), other = await login("vlad");
  const short = await call("/change-password", { body: { currentPassword: PW.vlad, newPassword: "123456789" }, cookie: cur });
  assert.equal(short.status, 400);
  const bad = await call("/change-password", { body: { currentPassword: "не тот", newPassword: "новый-пароль-1" }, cookie: cur });
  assert.notEqual(bad.status, 200);
  const ok = await call("/change-password", { body: { currentPassword: PW.vlad, newPassword: "новый-пароль-1", revokeOtherSessions: true }, cookie: cur });
  assert.equal(ok.status, 200);
  const curNow = ok.cookie || cur; // при revokeOtherSessions Better Auth выдаёт текущей сессии новую cookie
  assert.ok(await ctxOf(curNow), "текущая сессия осталась");
  assert.equal(await ctxOf(other), null);
  assert.equal((await signIn("vlad@example.com", PW.vlad)).status, 401);
  assert.equal((await signIn("vlad@example.com", "новый-пароль-1")).status, 200);
});

test("имя редактируется, email — нет", async () => {
  await importAuthUsers(db, LIST);
  const cookie = await login("vlad");
  assert.equal((await call("/update-user", { body: { name: "Владислав" }, cookie })).status, 200);
  assert.deepEqual((await repos.system.members("default"))[0], { id: "vlad", name: "Владислав" });
  await call("/update-user", { body: { email: "hack@example.com" }, cookie });
  assert.equal((await call("/get-session", { cookie })).json.user.email, "vlad@example.com");
});

test("сброс пароля: временный пароль входит, старый нет, все сессии завершены", async () => {
  await importAuthUsers(db, LIST);
  const cookie = await login("masha");
  const r = await resetPassword(db, " Masha@Example.com ");
  assert.equal(r.userId, "masha");
  assert.equal(r.sessions, 1);
  assert.ok(r.password.length >= 16);
  assert.equal(await ctxOf(cookie), null);
  assert.equal((await signIn("masha@example.com", PW.masha)).status, 401);
  assert.equal((await signIn("masha@example.com", r.password)).status, 200);
  await assert.rejects(resetPassword(db, "nobody@example.com"), /Нет пользователя/);
});

test("/api/quick: токен работает, cookie сессии вместо токена — нет; токен вместо cookie — нет", async () => {
  await importAuthUsers(db, LIST);
  const cookie = await login("vlad");
  const token = newToken("vlad");
  await repos.apiTokens.add({ userId: "vlad", householdId: "default" }, "t1", { name: "iPhone", hash: await hashToken(token), createdAt: new Date().toISOString(), lastUsedAt: null });
  const store = {
    tokens: (u) => repos.system.tokensOf(u), touch: (u, id, rec) => repos.system.touchToken(u, id, rec), hit: (id) => repos.system.hitToken(id),
    context: async () => ({ settings: null, personalCategories: [], expenses: [] }), write: async () => {},
  };
  const body = { text: "кофе 300", commit: false };
  assert.notEqual((await handleQuick(`Bearer ${token}`, body, store, "2026-10-20")).status, 401, "по токену пускает");
  assert.equal((await handleQuick(null, body, store, "2026-10-20")).status, 401, "без токена");
  const sessionToken = decodeURIComponent(cookie.split("=")[1]);
  assert.equal((await handleQuick(`Bearer ${sessionToken}`, body, store, "2026-10-20")).status, 401, "значение cookie сессии — не токен");
  assert.equal(await sessionCtx(auth, repos, new Headers({ authorization: `Bearer ${token}` })), null, "токен не даёт сессию");
  assert.equal(await ctxOf(`better-auth.session_token=${token}`), null, "токен в cookie не даёт сессию");
});
