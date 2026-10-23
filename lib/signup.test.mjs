// Регистрация: коды закрытой беты, ссылка-приглашение, подтверждение email, Turnstile, сброс пароля, письма.
// Запуск: npm run test
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { freshDb, caller } from "./test/auth-kit.mjs";

// Фейковый siteverify Turnstile: проходит только токен "ok"
const verify = http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d)).on("end", () => {
    res.setHeader("content-type", "application/json");
    // Без keep-alive: иначе под нагрузкой клиент берёт сокет, который сервер уже закрывает (ECONNRESET)
    res.setHeader("connection", "close");
    res.end(JSON.stringify({ success: JSON.parse(b).response === "ok" }));
  });
});
await new Promise((r) => verify.listen(0, "127.0.0.1", r));
process.env.TURNSTILE_SECRET_KEY = "test";
process.env.TURNSTILE_VERIFY_URL = `http://127.0.0.1:${verify.address().port}/siteverify`;
after(() => verify.close());

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { createAuth, sessionCtx } = await import("./auth.ts");
const { createSignupCode, listSignupCodes, revokeSignupCode, newInviteCode, hashCode, isAdmin } = await import("./codes.ts");
const { outbox } = await import("./mail.ts");
const { eq } = await import("drizzle-orm");

const OK = { "x-captcha-response": "ok" };
let db, sql, auth, call, repos;
beforeEach(async () => {
  ({ db, sql } = await freshDb(schema));
  auth = createAuth(db);
  call = caller(auth);
  repos = postgresRepos(db);
  outbox.length = 0;
  delete process.env.REGISTRATION_MODE;
});

const signUp = (email, extra = {}, headers = OK) =>
  call("/sign-up/email", { body: { name: "Новый", email, password: "пароль-новичка", ...extra }, headers });
const usersCount = async () => (await db.select().from(schema.users)).length;
const mailTo = (to) => outbox.filter((m) => m.to === to);
const linkIn = (m) => /https?:\/\/\S+/.exec(m.text)[0];

test("invite-режим: без кода, с неверным, истёкшим, отозванным, исчерпанным — один и тот же отказ", async () => {
  const { code: single } = await createSignupCode(db, null, 1, 7);
  const { code: expired } = await createSignupCode(db, null, 5, 7);
  await db.update(schema.signupCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.signupCodes.codeHash, (await import("./codes.ts")).hashSignupCode(expired)));
  const { code: revoked, item } = await createSignupCode(db, null, 5, 7);
  await revokeSignupCode(db, item.id);
  assert.equal((await signUp("a@example.com", { signupCode: single })).status, 200);

  const answers = [];
  for (const extra of [{}, { signupCode: "AAAAA-BBBBB" }, { signupCode: expired }, { signupCode: revoked }, { signupCode: single }, { inviteCode: "нет-такого" }]) {
    const r = await signUp(`x${answers.length}@example.com`, extra);
    answers.push([r.status, r.json?.code, r.json?.message]);
  }
  assert.deepEqual(new Set(answers.map((a) => JSON.stringify(a))).size, 1, JSON.stringify(answers));
  assert.deepEqual(answers[0], [400, "SIGNUP_CODE_INVALID", "Регистрация недоступна"]);
  assert.equal(await usersCount(), 1);
});

test("код: регистрация уменьшает uses_left; код вводится в любом регистре и без дефиса; занятый email код не тратит", async () => {
  const { code } = await createSignupCode(db, null, 3, 7);
  const first = await signUp("one@example.com", { signupCode: code.toLowerCase().replace("-", "") });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal((await listSignupCodes(db))[0].usesLeft, 2);
  // Занятый email: ответ как при успехе, пользователь не создан, код не списан
  const dup = await signUp("one@example.com", { signupCode: code });
  assert.equal(dup.status, 200);
  assert.equal(await usersCount(), 1);
  assert.equal((await listSignupCodes(db))[0].usesLeft, 2);
  assert.equal(mailTo("one@example.com").length, 1, "письмо о подтверждении — только одно");
});

test("регистрация по ссылке-приглашению — без кода; использованное или отозванное приглашение — отказ", async () => {
  await sql(`INSERT INTO users (id, name, email, email_verified) VALUES ('vlad', 'Влад', 'vlad@example.com', true);
    INSERT INTO households (id, name, kind) VALUES ('default', 'Семья', 'solo');
    INSERT INTO memberships (household_id, user_id, role) VALUES ('default', 'vlad', 'owner');`);
  const code = newInviteCode(), used = newInviteCode();
  await db.insert(schema.householdInvites).values([
    { id: "i1", householdId: "default", codeHash: hashCode(code), createdBy: "vlad", expiresAt: new Date(Date.now() + 86_400_000) },
    { id: "i2", householdId: "default", codeHash: hashCode(used), createdBy: "vlad", expiresAt: new Date(Date.now() + 86_400_000), usedAt: new Date(), usedBy: "vlad" },
  ]);
  const ok = await signUp("guest@example.com", { inviteCode: code, callbackURL: `/join/${code}` });
  assert.equal(ok.status, 200);
  assert.match(linkIn(mailTo("guest@example.com")[0]), new RegExp(`callbackURL=${encodeURIComponent(`/join/${code}`).replace(/[%]/g, "%")}`), "после подтверждения — обратно на /join");
  assert.equal((await signUp("other@example.com", { inviteCode: used })).json.code, "SIGNUP_CODE_INVALID");
});

test("open-режим: код не нужен; новый пользователь начинает со знакомства (pending)", async () => {
  process.env.REGISTRATION_MODE = "open";
  assert.equal((await signUp("free@example.com")).status, 200);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "free@example.com"));
  const [o] = await db.select().from(schema.userOnboarding).where(eq(schema.userOnboarding.userId, u.id));
  assert.equal(o.status, "pending");
});

test("до подтверждения email входа и API нет; ссылка из письма подтверждает и входит, первый запрос создаёт solo", async () => {
  const { code } = await createSignupCode(db, null, 1, 7);
  const r = await signUp("new@example.com", { signupCode: code });
  assert.equal(r.status, 200);
  assert.equal(r.cookie, "", "регистрация не создаёт сессию");
  assert.equal(r.json.token, null);
  const denied = await call("/sign-in/email", { body: { email: "new@example.com", password: "пароль-новичка" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, "EMAIL_NOT_VERIFIED");

  const [mail] = mailTo("new@example.com");
  assert.equal(mail.subject, "Подтвердите email");
  const v = await call(linkIn(mail));
  assert.equal(v.status, 302);
  assert.ok(v.cookie, "вход сразу после подтверждения");
  const s = await call("/get-session", { cookie: v.cookie });
  assert.equal(s.json.user.emailVerified, true);
  // Первый запрос после подтверждения — онбординг: бюджет одного человека
  const ctx = await sessionCtx(auth, repos, new Headers({ cookie: v.cookie }));
  assert.equal(ctx.userId, s.json.user.id);
  assert.equal((await repos.system.members(ctx.householdId)).length, 1);
  assert.equal((await call("/sign-in/email", { body: { email: "new@example.com", password: "пароль-новичка" } })).status, 200);
});

test("повторное письмо — не чаще раза в минуту", async () => {
  const { code } = await createSignupCode(db, null, 1, 7);
  await signUp("slow@example.com", { signupCode: code });
  const again = (ip) => call("/send-verification-email", { body: { email: "slow@example.com" }, ip });
  assert.equal((await again("10.7.7.7")).status, 200);
  assert.equal((await again("10.7.7.7")).status, 429);
  assert.equal(mailTo("slow@example.com").length, 2);
});

test("Turnstile на регистрации и сбросе пароля: без токена и с неверным — отказ, вход без капчи", async () => {
  process.env.REGISTRATION_MODE = "open";
  assert.equal((await signUp("c1@example.com", {}, {})).status, 400);
  assert.equal((await signUp("c2@example.com", {}, { "x-captcha-response": "bad" })).status, 403);
  assert.equal((await call("/request-password-reset", { body: { email: "c1@example.com" } })).status, 400);
  assert.equal(await usersCount(), 0);
  assert.equal((await signUp("c3@example.com")).status, 200);
  assert.notEqual((await call("/sign-in/email", { body: { email: "c3@example.com", password: "x" } })).status, 400, "вход капчу не требует");
});

test("сброс пароля: письмо со ссылкой, новый пароль входит, старый нет, сессии завершены, письмо «пароль изменён»", async () => {
  process.env.REGISTRATION_MODE = "open";
  await signUp("r@example.com");
  await call(linkIn(mailTo("r@example.com")[0]));
  const old = await call("/sign-in/email", { body: { email: "r@example.com", password: "пароль-новичка" } });
  outbox.length = 0;
  assert.equal((await call("/request-password-reset", { body: { email: "r@example.com", redirectTo: "/reset-password" }, headers: OK })).status, 200);
  assert.equal((await call("/request-password-reset", { body: { email: "nobody@example.com", redirectTo: "/reset-password" }, headers: OK })).status, 200, "ответ одинаковый");
  assert.deepEqual(outbox.map((m) => [m.to, m.subject]), [["r@example.com", "Сброс пароля"]]);
  const go = await call(linkIn(outbox[0]));
  assert.equal(go.status, 302);
  const token = new URL(go.location, "http://x").searchParams.get("token");
  assert.match(go.location, /\/reset-password\?token=/);
  assert.equal((await call("/reset-password", { body: { newPassword: "короткий", token } })).status, 400);
  assert.equal((await call("/reset-password", { body: { newPassword: "новый-пароль-123", token } })).status, 200);
  assert.equal((await call("/reset-password", { body: { newPassword: "ещё-один-пароль", token } })).status, 400, "ссылка одноразовая");
  assert.equal((await call("/get-session", { cookie: old.cookie })).json, null, "сессии завершены");
  assert.equal((await call("/sign-in/email", { body: { email: "r@example.com", password: "пароль-новичка" } })).status, 401);
  assert.equal((await call("/sign-in/email", { body: { email: "r@example.com", password: "новый-пароль-123" } })).status, 200);
  assert.ok(outbox.some((m) => m.to === "r@example.com" && m.subject === "Пароль изменён"));
});

test("смена пароля в настройках шлёт письмо «пароль изменён»", async () => {
  process.env.REGISTRATION_MODE = "open";
  await signUp("p@example.com");
  await call(linkIn(mailTo("p@example.com")[0]));
  const s = await call("/sign-in/email", { body: { email: "p@example.com", password: "пароль-новичка" } });
  outbox.length = 0;
  assert.equal((await call("/change-password", { body: { currentPassword: "пароль-новичка", newPassword: "другой-пароль-1" }, cookie: s.cookie })).status, 200);
  assert.deepEqual(outbox.map((m) => m.subject), ["Пароль изменён"]);
});

test("письма — на русском, без HTML-разметки в тексте", async () => {
  const { mails } = await import("./mail.ts");
  for (const m of [mails.verify("a@b.c", "https://x/v"), mails.reset("a@b.c", "https://x/r"), mails.passwordChanged("a@b.c"), mails.accountDeleted("a@b.c")]) {
    assert.match(m.text, /^:: [А-ЯЁA-Z ]+\n/);
    assert.doesNotMatch(m.text, /<[a-z]/i);
  }
});

test("коды: только хеш в базе, список с использованием, отзыв; админы из ADMIN_USER_IDS", async () => {
  const { code, item } = await createSignupCode(db, null, 2, 3);
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  const [row] = await db.select().from(schema.signupCodes);
  assert.ok(!JSON.stringify(row).includes(code.replace("-", "")), "кода в базе нет");
  assert.deepEqual((await listSignupCodes(db)).map((c) => [c.usesTotal, c.usesLeft, c.revoked]), [[2, 2, false]]);
  assert.equal(await revokeSignupCode(db, item.id), true);
  assert.equal(await revokeSignupCode(db, item.id), false);
  process.env.ADMIN_USER_IDS = "vlad, admin2";
  assert.equal(isAdmin("vlad"), true);
  assert.equal(isAdmin("masha"), false);
  delete process.env.ADMIN_USER_IDS;
  assert.equal(isAdmin("vlad"), false);
});

test("регистрация под чужим именем или с чужим id: id — случайный от сервера, чужие данные и права недоступны", async () => {
  await sql(`INSERT INTO users (id, name, email, email_verified) VALUES ('vlad', 'Влад', 'vlad@example.com', true);
    INSERT INTO households (id, name) VALUES ('default', 'Семья');
    INSERT INTO memberships (household_id, user_id, role) VALUES ('default', 'vlad', 'owner');`);
  process.env.REGISTRATION_MODE = "open";
  process.env.ADMIN_USER_IDS = "vlad";
  const r = await signUp("fake@example.com", { name: "vlad", id: "vlad", userId: "vlad", emailVerified: true, role: "admin" });
  assert.equal(r.status, 200);
  const [fake] = await db.select().from(schema.users).where(eq(schema.users.email, "fake@example.com"));
  assert.notEqual(fake.id, "vlad", "id не берётся из запроса");
  assert.match(fake.id, /^[A-Za-z0-9]{32}$/);
  assert.equal(fake.emailVerified, false, "подтверждение email из запроса не принимается");
  assert.equal(isAdmin(fake.id), false);
  const [real] = await db.select().from(schema.users).where(eq(schema.users.id, "vlad"));
  assert.deepEqual([real.name, real.email], ["Влад", "vlad@example.com"], "настоящий vlad не тронут");
  // Подтвердил email — получает свой новый бюджет, а не бюджет Влада
  const v = await call(linkIn(mailTo("fake@example.com")[0]));
  const ctx = await sessionCtx(auth, repos, new Headers({ cookie: v.cookie }));
  assert.notEqual(ctx.householdId, "default");
  assert.deepEqual((await repos.system.members("default")).map((u) => u.id), ["vlad"]);
  delete process.env.ADMIN_USER_IDS;
});
